import { select, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

// Each .txt file is processed individually (parallel, not bulk).
// The transformer uppercases its content and renames it to <basename>.out
export default select.parallel("assets/txt/*.txt").pipe(async ([file]) => {
  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw.toUpperCase());
  return [{ basename: file.basename + ".out", dirname: "", content: out }];
});
