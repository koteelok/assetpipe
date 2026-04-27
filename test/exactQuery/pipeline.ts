import { context, group, query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

export default context(
  "assets",

  group(
    query("a.txt").pipe(async (files) => {
      const texts = await Promise.all(
        files.map((f) => readFile(f.content, "utf-8")),
      );
      const out = tmpfile();
      await writeFile(out, `[${texts[0]}]`);
      return [{ basename: "a.txt", dirname: "", content: out }];
    }),
    query("b.txt").pipe(async (files) => {
      const texts = await Promise.all(
        files.map((f) => readFile(f.content, "utf-8")),
      );
      const out = tmpfile();
      await writeFile(out, `(${texts[0]})`);
      return [{ basename: "b.txt", dirname: "", content: out }];
    }),
    query("c.txt").pipe(async (files) => {
      const texts = await Promise.all(
        files.map((f) => readFile(f.content, "utf-8")),
      );
      const out = tmpfile();
      await writeFile(out, `{${texts[0]}}`);
      return [{ basename: "c.txt", dirname: "", content: out }];
    }),
  ).pipe(async (files) => {
    const texts = await Promise.all(
      files.map((f) => readFile(f.content, "utf-8")),
    );
    const out = tmpfile();
    await writeFile(out, texts.sort().join("|"));
    return [{ basename: "ctx_output.txt", dirname: "", content: out }];
  }),
);
