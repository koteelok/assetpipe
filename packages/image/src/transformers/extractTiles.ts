import { File, Transformer } from "@assetpipe/core/types";
import { tmpfile } from "@assetpipe/config";
import { extname } from "path";
import sharp, { OutputInfo, Region } from "sharp";

import { ArrayOr } from "../types";
import { ImageFormatOptions } from "../utils/imageFormat";
import { IMAGE_EXTENSIONS } from "../utils/imageFormat";

type TileSize = number | { width: number; height: number };
type TileSizeOptions = {
  source: File;
  sourceInfo: OutputInfo;
};
type TileBasenameOptions = {
  source: File;
  sourceInfo: OutputInfo;
  region: Region;
  tileSize: { width: number; height: number };
};
type SkipTileCallback = (
  channels: number[],
  pixel: { x: number; y: number },
  info: OutputInfo,
  source: File,
) => boolean;

export type ExtractTilesOptions = {
  /**
   * Specifies the width of the tiles to be extracted.
   *
   * If a single number is provided, it will be used for both width and height.
   *
   * By default, the tile size is 16.
   */
  tileSize?: TileSize | ((options: TileSizeOptions) => TileSize);

  /**
   * Callback to generate the basename for the tile files.
   */
  tileBasename?: (options: TileBasenameOptions) => string;

  /**
   * Space in pixels between tiles (default: 0)
   */
  gap?: number | { x: number; y: number };

  /**
   * Space in pixels around the tile (default: 0)
   */
  padding?: number | { x: number; y: number };

  /**
   * Option to configure tile skipping.
   *
   * By default, transformer skips all tiles that have empty alpha channel.
   */
  skipTile?: boolean | SkipTileCallback;

  /**
   * Option to disable skipping of partial tiles.
   *
   * By default, transformer skips all partial tiles.
   */
  skipPartial?: boolean;

  /**
   * Image output extension and options
   */
  imageFormat?: ArrayOr<ImageFormatOptions>;

  /**
   * Determines if the file is an image and should be processed by this transformer.
   *
   * By default, it checks the file extension against a set of known image extensions:
   * - .jpg
   * - .jpeg
   * - .png
   * - .webp
   * - .jp2
   * - .tiff
   * - .avif
   * - .heif
   * - .jxl
   */
  isImageFile?: (file: File) => boolean;
};

export function extractTiles(_options: ExtractTilesOptions): Transformer {
  const options = {
    tileSize: (() => {
      switch (typeof _options.tileSize) {
        case "number": {
          const value = _options.tileSize;
          return () => ({ width: value, height: value });
        }
        case "object": {
          const value = _options.tileSize;
          return () => value;
        }
        case "function": {
          const tileSizeFN = _options.tileSize;
          return (params: Parameters<typeof _options.tileSize>[0]) => {
            const tileSizeValue = tileSizeFN(params);
            if (typeof tileSizeValue === "number") {
              return { width: tileSizeValue, height: tileSizeValue };
            }
            return {
              width: tileSizeValue.width,
              height: tileSizeValue.height,
            };
          };
        }
        default:
          return () => ({ width: 16, height: 16 });
      }
    })(),

    gap: (() => {
      switch (typeof _options.gap) {
        case "number":
          return { x: _options.gap, y: _options.gap };
        case "object":
          return _options.gap;
        default:
          return { x: 0, y: 0 };
      }
    })(),

    padding: (() => {
      switch (typeof _options.padding) {
        case "number":
          return { x: _options.padding, y: _options.padding };
        case "object":
          return _options.padding;
        default:
          return { x: 0, y: 0 };
      }
    })(),

    skipTile: _options.skipTile,

    skipPartial: _options.skipPartial,

    tileBasename: _options.tileBasename,

    imageFormat: (() => {
      if (!_options.imageFormat) {
        return undefined;
      }

      if (Array.isArray(_options.imageFormat)) {
        return _options.imageFormat;
      }

      return [_options.imageFormat];
    })(),
  };

  return async (files) => {
    const resultFiles: File[] = [];

    await Promise.all(
      files.map(async (file) => {
        if (_options.isImageFile !== undefined) {
          if (!_options.isImageFile(file)) {
            resultFiles.push(file);
            return;
          }
        } else {
          if (!IMAGE_EXTENSIONS.has(extname(file.basename))) {
            resultFiles.push(file);
            return;
          }
        }

        const image = sharp(file.content);
        const metadata = await image.metadata();
        const raw = await image.raw().toBuffer({ resolveWithObject: true });

        if (
          metadata.width === undefined ||
          metadata.height === undefined ||
          metadata.channels === undefined
        ) {
          throw new Error("Invalid image");
        }

        const tileChannels = [];
        const tilePosition = { x: 0, y: 0 };
        let tileCheck: Exclude<ExtractTilesOptions["skipTile"], boolean>;

        if (options.skipTile !== false) {
          if (typeof options.skipTile === "function") {
            tileCheck = options.skipTile;
          }

          if (!tileCheck && metadata.channels === 4) {
            tileCheck = (channels: number[]) => channels[3] === 0;
          }
        }

        const tileSize = options.tileSize({
          source: file,
          sourceInfo: raw.info,
        });

        for (
          let top = options.padding.y;
          top < metadata.height;
          top += tileSize.height + options.gap.x
        ) {
          for (
            let left = options.padding.x;
            left < metadata.width;
            left += tileSize.width + options.gap.y
          ) {
            const extractWidth = Math.min(
              tileSize.width,
              metadata.width - left,
            );
            const extractHeight = Math.min(
              tileSize.height,
              metadata.height - top,
            );

            if (
              options.skipPartial &&
              (extractWidth < tileSize.width || extractHeight < tileSize.height)
            ) {
              continue;
            }

            if (
              (options.skipTile === true || options.skipTile === undefined) &&
              metadata.channels === 4
            ) {
              let empty = true;

              emptyCheck: for (
                let y = top * metadata.width * 4;
                y < (top + tileSize.height) * metadata.width * 4;
                y += metadata.width * 4
              ) {
                for (
                  let x = left * 4 + 3;
                  x < (left + tileSize.width) * 4;
                  x += 4
                ) {
                  if (raw.data[x + y] > 0) {
                    empty = false;
                    break emptyCheck;
                  }
                }
              }

              if (empty) continue;
            } else if (typeof options.skipTile === "function") {
              let empty = true;

              emptyCheck: for (let y = 0; y < extractHeight; y++) {
                for (let x = 0; x < extractWidth; x++) {
                  const rawIndex =
                    ((top + y) * metadata.width + (left + x)) *
                    metadata.channels;

                  for (let i = 0; i < metadata.channels; i++) {
                    tileChannels[i] = raw.data[rawIndex + i];
                  }

                  tilePosition.x = left + x;
                  tilePosition.y = top + y;

                  if (
                    options.skipTile(tileChannels, tilePosition, raw.info, file)
                  ) {
                    empty = false;
                    break emptyCheck;
                  }
                }
              }

              if (empty) continue;
            }

            const region = {
              left,
              top,
              width: extractWidth,
              height: extractHeight,
            };

            if (!options.imageFormat) {
              if (
                metadata.format &&
                IMAGE_EXTENSIONS.has(`.${metadata.format}`)
              ) {
                options.imageFormat = [{ extension: metadata.format as any }];
              } else {
                throw new Error(
                  `Failed to determine image format for ${file.basename}. Please specify imageFormat option.`,
                );
              }
            }

            await Promise.all(
              options.imageFormat.map(async (format) => {
                const output = tmpfile();

                await new Promise<void>((resolve) =>
                  image
                    .clone()
                    .extract(region)
                    .toFormat(format.extension, format)
                    .toFile(output, (err) => {
                      if (err) throw err;

                      let basename: string;

                      if (options.tileBasename !== undefined) {
                        basename = options.tileBasename({
                          source: file,
                          region,
                          sourceInfo: raw.info,
                          tileSize,
                        });
                      } else {
                        const extension = extname(file.basename);
                        basename = `${file.basename.replace(extension, "")}_${left}_${top}${extension}`;
                      }

                      resultFiles.push({
                        basename,
                        dirname: file.dirname,
                        content: output,
                      });

                      resolve();
                    }),
                );
              }),
            );
          }
        }
      }),
    );

    return resultFiles;
  };
}
