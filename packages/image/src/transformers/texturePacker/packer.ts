import { File } from "@assetpipe/core/types";
import { tmpfile } from "@assetpipe/config";
import { MaxRectsPacker, type Rectangle } from "maxrects-packer";
import sharp from "sharp";

import type { ResolvedOptions } from "./options";

export interface AssetRectangle {
  width: number;
  height: number;
  file: File;
  trimmed: boolean;
  offsetX: number;
  offsetY: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface Atlas {
  name: string;
  images: File[];
  width: number;
  height: number;
  textures: {
    source: File;
    frame: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    rotated: boolean;
    trim?: {
      offsetX: number;
      offsetY: number;
      originalWidth: number;
      originalHeight: number;
    };
  }[];
}

export async function packAssets(
  options: ResolvedOptions,
  rectangles: AssetRectangle[],
): Promise<Atlas[]> {
  const packer = new MaxRectsPacker<Rectangle & AssetRectangle>(
    options.width ?? options.maxWidth,
    options.height ?? options.maxHeight,
    options.gap,
    {
      allowRotation: options.rotate,
      smart: options.smartSizing,
      pot: options.powerOfTwo,
      square: options.squareSize,
      border: options.border,
      logic: options.logic,
    },
  );

  // @ts-expect-error I swear it works
  packer.addArray(rectangles);

  return Promise.all(
    packer.bins.map(async (bin, index, bins) => {
      const atlas = sharp({
        create: {
          width: options.width ?? bin.width,
          height: options.height ?? bin.height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      });

      const compositeOptions = await Promise.all(
        bin.rects.map(async (rect) => {
          let input: string;

          if (rect.rot) {
            input = tmpfile();
            await sharp(rect.file.content).rotate(90).toFile(input);
          } else {
            input = rect.file.content;
          }

          return {
            input,
            left: rect.x,
            top: rect.y,
            rect,
          };
        }),
      );

      atlas.composite(compositeOptions);

      const textures = bin.rects.map((rect) => ({
        source: rect.file,
        frame: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        rotated: rect.rot,
        trim: rect.trimmed
          ? {
              offsetX: rect.offsetX,
              offsetY: rect.offsetY,
              originalWidth: rect.sourceWidth,
              originalHeight: rect.sourceHeight,
            }
          : undefined,
      }));

      let width = 0;
      let height = 0;

      const name = `${options.name}${bins.length > 1 ? options.separator + index.toString() : ""}`;

      const images: File[] = await Promise.all(
        options.imageFormat.map(async (format) => {
          const output = tmpfile();

          const info = await atlas
            .clone()
            .toFormat(format.extension, format)
            .toFile(output);

          width = Math.max(width, info.width);
          height = Math.max(height, info.height);

          return {
            basename: `${name}.${format.extension}`,
            dirname: options.output,
            content: output,
          };
        }),
      );

      return { name, images, textures, width, height };
    }),
  );
}
