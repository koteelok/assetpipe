import { File, context, group, query, tmpfile } from "@assetpipe/config";
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
      return [new File("a.txt", out)];
    }),
    query("b.txt").pipe(async (files) => {
      const texts = await Promise.all(
        files.map((f) => readFile(f.content, "utf-8")),
      );
      const out = tmpfile();
      await writeFile(out, `(${texts[0]})`);
      return [new File("b.txt", out)];
    }),
    query("c.txt").pipe(async (files) => {
      const texts = await Promise.all(
        files.map((f) => readFile(f.content, "utf-8")),
      );
      const out = tmpfile();
      await writeFile(out, `{${texts[0]}}`);
      return [new File("c.txt", out)];
    }),
  ).pipe(async (files) => {
    const texts = await Promise.all(
      files.map((f) => readFile(f.content, "utf-8")),
    );
    const out = tmpfile();
    await writeFile(out, texts.sort().join("|"));
    return [new File("ctx_output.txt", out)];
  }),
);
