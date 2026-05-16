import { path, query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

// Files are grouped by their parent directory name (e.g. "txt", "json").
// The transformer concatenates files in each group into one output bundle.
export default query("assets/**/*.*", {
  groupBy: (file) => path.dirname(file),
}).pipe(async (files) => {
  const texts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  const dir = path.dirname(files[0]);
  const group = dir === "." ? path.basename(files[0]) : path.basename(dir);
  const out = tmpfile();
  await writeFile(out, texts.join("\n"));
  return [{ target: `${group}.bundle`, content: out }];
});
