import { group, query, tmpfile } from "@assetpipe/config";
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

const source = query("assets/*.txt", { parallel: true }).pipe(
  async ([file]) => {
    await bumpCounter("source-" + file.basename);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [file.withContent(out)];
  },
);

const cloneA = source.clone().pipe(async ([file]) => {
  await bumpCounter("cloneA-" + file.basename);
  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw + " A");
  return [file.withBasename(file.basename + ".a").withContent(out)];
});

const cloneB = source.clone().pipe(async ([file]) => {
  await bumpCounter("cloneB-" + file.basename);
  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw + " B");
  return [file.withBasename(file.basename + ".b").withContent(out)];
});

export default group(cloneA, cloneB);
