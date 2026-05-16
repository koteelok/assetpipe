import { group, path, query, tmpfile } from "@assetpipe/config";
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
    await bumpCounter("source-" + path.basename(file));
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [{ ...file, content: out }];
  },
);

const cloneA = source.clone().pipe(async ([file]) => {
  await bumpCounter("cloneA-" + path.basename(file));
  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw + " A");
  return [{ ...file, target: file.target + ".a", content: out }];
});

const cloneB = source.clone().pipe(async ([file]) => {
  await bumpCounter("cloneB-" + path.basename(file));
  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw + " B");
  return [{ ...file, target: file.target + ".b", content: out }];
});

export default group(cloneA, cloneB);
