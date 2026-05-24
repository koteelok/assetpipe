import { extname } from "node:path";
import { writeFile } from "node:fs/promises";

import { File, Transformer } from "@assetpipe/core/types";
import { tmpfile } from "@assetpipe/config";
import sharp from "sharp";

import { IMAGE_EXTENSIONS } from "../utils/imageFormat";

type Size = { width: number; height: number };

export type OnCompleteOptions = {
  /** The original, untrimmed input file. */
  source: File;
  /** Dimensions of the source image, in pixels. */
  sourceSize: Size;
  /** Dimensions of the trimmed image, in pixels. */
  trimmedSize: Size;
  /** Pixels removed from the left and top edges. */
  trimOffset: { left: number; top: number };
};

export type TrimImagesOptions = {
  /**
   * Background color to trim from the edges.
   *
   * By default, the top-left pixel is used (sharp's default).
   */
  background?: string | { r: number; g: number; b: number; alpha?: number };

  /**
   * Allowed difference from the background color (sharp default: 10).
   *
   * Higher values trim more aggressively.
   */
  threshold?: number;

  /**
   * Treat the input as line art, trimming based on luminance rather than
   * color (sharp's lineArt).
   */
  lineArt?: boolean;

  /**
   * Drop fully-uniform images instead of passing them through untouched.
   *
   * By default, an image that has nothing to trim (every pixel matches the
   * background) is emitted unchanged.
   */
  skipEmpty?: boolean;

  /**
   * Called for every trimmed image. Returns extra files to emit alongside the
   * trimmed image (e.g. a sidecar describing the trim offset).
   *
   * Not called for fully-uniform images, since no trim is performed.
   */
  onComplete?: (options: OnCompleteOptions) => File[];

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

export function trimImages(options: TrimImagesOptions = {}): Transformer {
  const trimOptions: sharp.TrimOptions = {};
  if (options.background !== undefined) trimOptions.background = options.background;
  if (options.threshold !== undefined) trimOptions.threshold = options.threshold;
  if (options.lineArt !== undefined) trimOptions.lineArt = options.lineArt;

  return async (files) => {
    const resultFiles: File[] = [];

    await Promise.all(
      files.map(async (file) => {
        if (options.isImageFile !== undefined) {
          if (!options.isImageFile(file)) {
            resultFiles.push(file);
            return;
          }
        } else if (!IMAGE_EXTENSIONS.has(extname(file.basename))) {
          resultFiles.push(file);
          return;
        }

        const image = sharp(file.content);
        const metadata = await image.metadata();

        if (metadata.width === undefined || metadata.height === undefined) {
          throw new Error(`Invalid image: ${file.basename}`);
        }

        if (
          metadata.format === undefined ||
          !IMAGE_EXTENSIONS.has(`.${metadata.format}`)
        ) {
          throw new Error(
            `Failed to determine image format for ${file.basename}.`,
          );
        }

        const sourceSize: Size = {
          width: metadata.width,
          height: metadata.height,
        };

        const { data, info } = await image
          .trim(trimOptions)
          .toFormat(metadata.format)
          .toBuffer({ resolveWithObject: true });

        const trimmedSize: Size = { width: info.width, height: info.height };
        const trimOffset = {
          left: -(info.trimOffsetLeft ?? 0),
          top: -(info.trimOffsetTop ?? 0),
        };

        const nothingTrimmed =
          info.width === sourceSize.width && info.height === sourceSize.height;

        if (nothingTrimmed) {
          // A uniform image and an already-tight image both trim to nothing.
          // Tell them apart with channel statistics: a uniform image has no
          // variation (min === max) on every channel.
          const stats = await sharp(file.content).stats();
          const uniform = stats.channels.every(
            (channel) => channel.min === channel.max,
          );

          if (uniform) {
            if (!options.skipEmpty) resultFiles.push(file);
            return;
          }

          // Already tight: keep the original bytes untouched.
          resultFiles.push(file);
        } else {
          const output = tmpfile();
          await writeFile(output, data);
          resultFiles.push(file.withContent(output));
        }

        if (options.onComplete !== undefined) {
          resultFiles.push(
            ...options.onComplete({
              source: file,
              sourceSize,
              trimmedSize,
              trimOffset,
            }),
          );
        }
      }),
    );

    return resultFiles;
  };
}
