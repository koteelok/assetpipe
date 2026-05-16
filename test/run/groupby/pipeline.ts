import { query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import { posix } from "path";

// Files are grouped by their parent directory name (e.g. "txt", "json").
// The transformer concatenates files in each group into one output bundle.
export default query("assets/**/*.*", {
  groupBy: (file) => posix.dirname(file.target),
}).pipe(async (files) => {
  const texts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  const dir = posix.dirname(files[0].target);
  const group = posix.basename(dir === "." ? files[0].target : dir);
  const out = tmpfile();
  await writeFile(out, texts.join("\n"));
  return [{ target: `${group}.bundle`, content: out }];
});
