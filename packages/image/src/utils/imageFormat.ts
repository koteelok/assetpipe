import type {
  AvifOptions,
  HeifOptions,
  Jp2Options,
  JpegOptions,
  JxlOptions,
  PngOptions,
  TiffOptions,
  WebpOptions,
} from "sharp";

export type ImageFormatOptions =
  | ({ extension: "jpg" | "jpeg" } & JpegOptions)
  | ({ extension: "png" } & PngOptions)
  | ({ extension: "webp" } & WebpOptions)
  | ({ extension: "jp2" } & Jp2Options)
  | ({ extension: "tiff" } & TiffOptions)
  | ({ extension: "avif" } & AvifOptions)
  | ({ extension: "heif" } & HeifOptions)
  | ({ extension: "jxl" } & JxlOptions);

export const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".jp2",
  ".tiff",
  ".avif",
  ".heif",
  ".jxl",
]);
