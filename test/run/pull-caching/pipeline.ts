import { File, group, query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

async function jsonjoin(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (file) => {
      const array = JSON.parse(await readFile(file.content, "utf-8"));
      const out = tmpfile();
      await writeFile(out, array.join(""));
      return {
        basename: file.basename.replace("json", "txt"),
        dirname: file.dirname,
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
        files.find((file) => file.basename.startsWith("1"))!.content,
        "utf-8",
      );
      const text2 = await readFile(
        files.find((file) => file.basename.startsWith("2"))!.content,
        "utf-8",
      );
      const out = tmpfile();
      await writeFile(out, `${text1}${text2}${text1}`);
      return [{ basename: `2.txt`, dirname: "", content: out }];
    }),

  group()
    .pull(chunksPipeline)
    .pipe(async (files) => {
      const text = await readFile(files[0].content, "utf-8");
      return Promise.all(
        text.split("").map(async (char) => {
          const out = tmpfile();
          await writeFile(out, `[${char}]`);
          return { basename: `1_${char}.txt`, dirname: "", content: out };
        }),
      );
    }),
).pipe(async (files) => {
  const texts = await Promise.all(
    files
      .sort((a, b) => (a.basename > b.basename ? 1 : -1))
      .map((file) => readFile(file.content, "utf-8")),
  );
  const out = tmpfile();
  await writeFile(out, texts.join("\n"));
  return [{ basename: `bundle.txt`, dirname: "", content: out }];
});
