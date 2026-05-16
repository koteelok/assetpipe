import { extname } from "node:path";

import { File, Transformer } from "@assetpipe/core/types";
import { tmpfile } from "@assetpipe/config";
import sharp from "sharp";

import { IMAGE_EXTENSIONS } from "../utils/imageFormat";
import { ImageFormatOptions } from "../utils/imageFormat";

export type ConvertImageOptions = {
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
} & ImageFormatOptions;

export function convertImage(options: ConvertImageOptions): Transformer {
  return async (files) => {
    return Promise.all(
      files.map(async (file) => {
        if (options.isImageFile !== undefined) {
          if (!options.isImageFile(file)) return file;
        } else {
          if (!IMAGE_EXTENSIONS.has(extname(file.basename))) return file;
        }

        const image = sharp(file.content);
        const output = tmpfile();
        await image.toFormat(options.extension, options).toFile(output);

        return file
          .withExtname(`.${options.extension}`)
          .withContent(output);
      }),
    );
  };
}
