import { query, tmpfile } from "@assetpipe/config";
import { mkdir, readFile, writeFile } from "fs/promises";
import { posix, resolve } from "path";

export default query("assets/**/*.txt", {
  groupBy: (file) => posix.dirname(file.target),
}).pipe(async (files) => {
  const tag = posix.dirname(files[0].target);
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
