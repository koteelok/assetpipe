import { File, group, query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

async function jsonjoin(files: readonly File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (file) => {
      const array = JSON.parse(await readFile(file.content, "utf-8"));
      const out = tmpfile();
      await writeFile(out, array.join(""));
      return file
        .withBasename(file.basename.replace("json", "txt"))
        .withContent(out);
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
        files.find((file) => file.basename.startsWith("1"))!.content,
        "utf-8",
      );
      const text2 = await readFile(
        files.find((file) => file.basename.startsWith("2"))!.content,
        "utf-8",
      );
      const out = tmpfile();
      await writeFile(out, `${text1}${text2}${text1}`);
      return [new File({ target: `2.txt`, content: out })];
    }),

  group()
    .pull(chunksPipeline)
    .pipe(async (files) => {
      const text = await readFile(files[0].content, "utf-8");
      return Promise.all(
        text.split("").map(async (char) => {
          const out = tmpfile();
          await writeFile(out, `[${char}]`);
          return new File({ target: `1_${char}.txt`, content: out });
        }),
      );
    }),
).pipe(async (files) => {
  const texts = await Promise.all(
    files
      .toSorted((a, b) => (a.basename > b.basename ? 1 : -1))
      .map((file) => readFile(file.content, "utf-8")),
  );
  const out = tmpfile();
  await writeFile(out, texts.join("\n"));
  return [new File({ target: `bundle.txt`, content: out })];
});
