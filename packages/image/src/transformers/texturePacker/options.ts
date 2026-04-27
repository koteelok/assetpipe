import { File } from "@assetpipe/core/types";
import { PACKING_LOGIC } from "maxrects-packer";

import { ArrayOr } from "../../types";
import { ImageFormatOptions } from "../../utils/imageFormat";
import { DataFormatFunction, dataFormats } from "./dataFormats";

export interface TexturePackerOptions {
  /** name for output files (default: "atlas") */
  name?: string;

  /**
   * Separator between name and atlas index.
   * Used only if created more than 1 texture atlas. (default: "-")
   */
  separator?: string;

  /**  Exact width of the output texture atlas */
  width?: number;

  /** Exact width of the output texture atlas */
  height?: number;

  /**  Maximum allowed width of the output texture atlas (default: 4096) */
  maxWidth?: number;

  /** Maximum allowed height of the output texture atlas (default: 4096) */
  maxHeight?: number;

  /** Space in pixels between images/glyphs (default: 0) */
  gap?: number;

  /** Allow rotation of images (default: true) */
  rotate?: boolean;

  /** Allow texture trimming (default: true) */
  trim?: boolean;

  /** Use smart sizing packer (default: true) */
  smartSizing?: boolean;

  /** Use power of two sizing (default: false) */
  powerOfTwo?: boolean;

  /** Use square size (default: false) */
  squareSize?: boolean;

  /** Space around atlas edge (default: 0) */
  border?: number;

  /** Packing logic to use (default: MAX_EDGE) */
  logic?: PACKING_LOGIC;

  /** Path to output files (default: "") */
  output?: string;

  /** Image output extension and options */
  imageFormat?: ArrayOr<ImageFormatOptions>;

  /**
   * Atlas data file generation options.
   *
   * You can use built-in templates:
   * - [TexturePacker](https://www.codeandweb.com/texturepacker)
   *
   * Or you can provide a custom function that returns an array of files.
   */
  dataFormat?: "TexturePacker" | "raw" | DataFormatFunction;

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
}

export function resolveOptions(options?: TexturePackerOptions) {
  return {
    name: options?.name ?? "atlas",
    separator: options?.separator ?? "-",
    maxWidth: options?.maxWidth ?? 4096,
    maxHeight: options?.maxHeight ?? 4096,
    gap: options?.gap ?? 0,
    rotate: options?.rotate ?? true,
    trim: options?.trim ?? true,
    smartSizing: options?.smartSizing ?? true,
    powerOfTwo: options?.powerOfTwo ?? false,
    squareSize: options?.squareSize ?? false,
    border: options?.border ?? 0,
    logic: options?.logic ?? PACKING_LOGIC.MAX_EDGE,
    output: options?.output ?? "",
    width: options?.width,
    height: options?.height,
    dataFormat: ((): DataFormatFunction => {
      if (options?.dataFormat === "TexturePacker") {
        return dataFormats.TexturePacker;
      }

      if (typeof options?.dataFormat == "function") {
        return options.dataFormat;
      }

      return dataFormats.raw;
    })(),
    isImageFile: options?.isImageFile,
    imageFormat: ((): ImageFormatOptions[] => {
      if (options?.imageFormat === undefined) {
        return [{ extension: "png" }];
      }

      if (Array.isArray(options.imageFormat)) {
        return options.imageFormat;
      }

      return [options.imageFormat];
    })(),
  };
}

export type ResolvedOptions = ReturnType<typeof resolveOptions>;
