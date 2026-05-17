import { query, tmpfile } from "@assetpipe/config";
import { File } from "@assetpipe/core/types";
import { mkdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";

const counterDir = resolve(__dirname, "counters");

async function bumpCounter(name: string) {
  await mkdir(counterDir, { recursive: true });
  const file = resolve(counterDir, name + ".json");
  let count = 0;
  try {
    count = JSON.parse(await readFile(file, "utf-8"));
  } catch {}
  count++;
  await writeFile(file, JSON.stringify(count));
}

const source = query("assets/*.txt").pipe(async (files) => {
  await bumpCounter("source");
  const texts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  const out = tmpfile();
  await writeFile(out, texts.sort().join(","));
  return [new File({ target: "joined.txt", content: out })];
});

export default source.clone().pipe(async (files) => {
  await bumpCounter("cloned");
  const raw = await readFile(files[0].content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw.toUpperCase());
  return [new File({ target: "joined.upper.txt", content: out })];
});
