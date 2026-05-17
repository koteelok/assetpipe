import { query, tmpfile } from "@assetpipe/config";
import { File } from "@assetpipe/core/types";
import { readFile, writeFile } from "fs/promises";

// Tests the .branch() operation: one transformer uppercases, one lowercases.
// Both receive the same input files and the results are merged.
async function upper(files: readonly File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (f) => {
      const raw = await readFile(f.content, "utf-8");
      const out = tmpfile();
      await writeFile(out, raw.toUpperCase());
      return new File({ target: `upper_${f.basename}`, content: out });
    }),
  );
}

async function lower(files: readonly File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (f) => {
      const raw = await readFile(f.content, "utf-8");
      const out = tmpfile();
      await writeFile(out, raw.toLowerCase());
      return new File({ target: `lower_${f.basename}`, content: out });
    }),
  );
}

export default query("assets/*.txt").branch(upper, lower);
