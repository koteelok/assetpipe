import { File, group, path, query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

async function jsonjoin(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (file) => {
      const array = JSON.parse(await readFile(file.content, "utf-8"));
      const out = tmpfile();
      await writeFile(out, array.join(""));
      return {
        target: file.target.replace("json", "txt"),
        content: out,
      };
    }),
  );
}

const chunksPipeline = query("assets/1.json").pipe(jsonjoin);

export default group(
  query("assets/2.json")
    .pipe(jsonjoin)
    .pull(chunksPipeline)
    .pipe(async (files) => {
      const text1 = await readFile(
        files.find((file) => path.basename(file).startsWith("1"))!.content,
        "utf-8",
      );
      const text2 = await readFile(
        files.find((file) => path.basename(file).startsWith("2"))!.content,
        "utf-8",
      );
      const out = tmpfile();
      await writeFile(out, `${text1}${text2}${text1}`);
      return [{ target: `2.txt`, content: out }];
    }),

  group()
    .pull(chunksPipeline)
    .pipe(async (files) => {
      const text = await readFile(files[0].content, "utf-8");
      return Promise.all(
        text.split("").map(async (char) => {
          const out = tmpfile();
          await writeFile(out, `[${char}]`);
          return { target: `1_${char}.txt`, content: out };
        }),
      );
    }),
).pipe(async (files) => {
  const texts = await Promise.all(
    files
      .sort((a, b) => (a.target > b.target ? 1 : -1))
      .map((file) => readFile(file.content, "utf-8")),
  );
  const out = tmpfile();
  await writeFile(out, texts.join("\n"));
  return [{ target: `bundle.txt`, content: out }];
});
