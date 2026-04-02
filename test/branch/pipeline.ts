import { query, tmpfile } from "@assetpipe/config";
import type { File } from "@assetpipe/core/types";
import { readFile, writeFile } from "fs/promises";

// Tests the .branch() operation: one transformer uppercases, one lowercases.
// Both receive the same input files and the results are merged.
async function upper(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (f) => {
      const raw = await readFile(f.content, "utf-8");
      const out = tmpfile();
      await writeFile(out, raw.toUpperCase());
      return { basename: `upper_${f.basename}`, dirname: "", content: out };
    }),
  );
}

async function lower(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (f) => {
      const raw = await readFile(f.content, "utf-8");
      const out = tmpfile();
      await writeFile(out, raw.toLowerCase());
      return { basename: `lower_${f.basename}`, dirname: "", content: out };
    }),
  );
}

export default query("assets/*.txt", { bulk: true }).branch(upper, lower);
