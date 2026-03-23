import { select, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import path from "path";

// Files are grouped by their parent directory name (e.g. "txt", "json").
// The transformer concatenates files in each group into one output bundle.
export default select
  .groupBy("assets/**/*.*", (file) => file.dirname)
  .pipe(async (files) => {
    const texts = await Promise.all(
      files.map((f) => readFile(f.content, "utf-8")),
    );
    const group = path.basename(files[0].dirname || files[0].basename);
    const out = tmpfile();
    await writeFile(out, texts.join("\n"));
    return [{ basename: `${group}.bundle`, dirname: "", content: out }];
  });
