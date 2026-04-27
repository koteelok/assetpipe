import { extname } from "node:path";

import { File, Transformer } from "@assetpipe/core/types";
import { tmpfile } from "@assetpipe/config";
import sharp from "sharp";

import { IMAGE_EXTENSIONS } from "../../utils/imageFormat";
import { resolveOptions, type TexturePackerOptions } from "./options";
import { type AssetRectangle, packAssets } from "./packer";

export function texturePacker(options?: TexturePackerOptions): Transformer {
  const _options = resolveOptions(options);

  return async (files: File[]) => {
    const output: File[] = [];
    const packRectangles: AssetRectangle[] = [];

    await Promise.all(
      files.map(async (file) => {
        if (_options.isImageFile !== undefined) {
          if (!_options.isImageFile(file)) {
            output.push(file);
            return;
          }
        } else {
          if (!IMAGE_EXTENSIONS.has(extname(file.basename))) {
            output.push(file);
            return;
          }
        }

        const image = sharp(file.content);

        const metadata = await image.metadata();
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;

        if (_options.trim && width > 3 && height > 3) {
          const output = tmpfile();
          const info = await image
            .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
            .toFile(output);

          if (
            info.trimOffsetTop === undefined ||
            info.trimOffsetLeft === undefined
          ) {
            throw new Error("Trim failed");
          }

          packRectangles.push({
            width: info.width,
            height: info.height,
            trimmed: true,
            offsetX: -info.trimOffsetLeft,
            offsetY: -info.trimOffsetTop,
            sourceWidth: width,
            sourceHeight: height,
            file: {
              basename: file.basename,
              dirname: file.dirname,
              content: output,
            },
          });
          return;
        }

        packRectangles.push({
          width,
          height,
          file,
          trimmed: false,
          offsetX: 0,
          offsetY: 0,
          sourceWidth: width,
          sourceHeight: height,
        });
      }),
    );

    const atlases = await packAssets(_options, packRectangles);

    for (const atlas of atlases) {
      for (const image of atlas.images) {
        output.push({
          basename: image.basename,
          dirname: _options.output,
          content: image.content,
        });
      }
    }

    await Promise.all(
      atlases.map(async (atlas) => {
        const files = await _options.dataFormat(atlas, _options);
        output.push(...files);
      }),
    );

    return output;
  };
}
