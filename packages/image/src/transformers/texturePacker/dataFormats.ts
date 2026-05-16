import { File } from "@assetpipe/core/types";
import { tmpfile } from "@assetpipe/config";
import { writeFile } from "fs/promises";
import { posix } from "path";

import { MaybePromise } from "../../types";
import { ResolvedOptions } from "./options";
import { Atlas } from "./packer";

export type DataFormatFunction = (
  atlas: Atlas,
  options: ResolvedOptions,
) => MaybePromise<File[]>;

const raw: DataFormatFunction = async (atlas, options) => {
  const output = tmpfile();
  await writeFile(output, JSON.stringify(atlas));
  return [new File(posix.join(options.output, `${atlas.name}.json`), output)];
};

const TexturePacker: DataFormatFunction = async (atlas, options) => {
  const output = tmpfile();
  await writeFile(
    output,
    JSON.stringify({
      frames: atlas.textures.reduce((obj, curr) => {
        obj[curr.source.target] = {
          frame: {
            x: curr.frame.x,
            y: curr.frame.y,
            w: curr.frame.width,
            h: curr.frame.height,
          },
          rotated: curr.rotated,
          trimmed: curr.trim !== undefined,
          spriteSourceSize: {
            x: curr.trim?.offsetX ?? 0,
            y: curr.trim?.offsetY ?? 0,
            w: curr.frame.width,
            h: curr.frame.height,
          },
          sourceSize: {
            w: curr.trim?.originalWidth ?? curr.frame.width,
            h: curr.trim?.originalHeight ?? curr.frame.height,
          },
          pivot: {
            x: 0.5,
            y: 0.5,
          },
        };

        return obj;
      }, {} as any),

      meta: {
        image: atlas.images[0].basename,
        size: { w: atlas.width, h: atlas.height },
        scale: "1",
      },
    }),
  );
  return [new File(posix.join(options.output, `${atlas.name}.json`), output)];
};

export const dataFormats = { raw, TexturePacker };
