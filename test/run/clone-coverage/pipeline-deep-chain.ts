import { query, tmpfile } from "@assetpipe/config";
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

const c1 = source.clone().pipe(async ([file]) => {
  await bumpCounter("c1-" + file.basename);
  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw + "/1");
  return [file.withContent(out)];
});

const c2 = c1.clone().pipe(async ([file]) => {
  await bumpCounter("c2-" + file.basename);
  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw + "/2");
  return [file.withContent(out)];
});

const c3 = c2.clone().pipe(async ([file]) => {
  await bumpCounter("c3-" + file.basename);
  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw + "/3");
  return [file.withBasename(file.basename + ".out").withContent(out)];
});

export default c3;
