import { context, select, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

// context() sets the root directory so inner queries resolve relative to it.
// Here the context root is "assets/" and the inner select picks up all *.txt.
export default context(
  "assets",
  select.bulk("*.txt").pipe(async (files) => {
    const texts = await Promise.all(
      files.map((f) => readFile(f.content, "utf-8")),
    );
    const out = tmpfile();
    await writeFile(out, texts.sort().join("|"));
    return [{ basename: "ctx_output.txt", dirname: "", content: out }];
  }),
);
