import { path, query, tmpfile } from "@assetpipe/config";
import { mkdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";

export default query("assets/**/*.txt", {
  groupBy: (file) => path.dirname(file),
}).pipe(async (files) => {
  const tag = path.dirname(files[0]);
  const counterDir = resolve(__dirname, "counters");
  await mkdir(counterDir, { recursive: true });
  const counterFile = resolve(counterDir, tag + ".json");
  let count = 0;
  try {
    count = JSON.parse(await readFile(counterFile, "utf-8"));
  } catch {}
  count++;
  await writeFile(counterFile, JSON.stringify(count));

  const texts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  const out = tmpfile();
  await writeFile(out, texts.join("\n"));
  return [{ target: `${tag}.bundle`, content: out }];
});
