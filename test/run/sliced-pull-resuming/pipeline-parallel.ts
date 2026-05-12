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

const extras = query("assets/extras/*.txt").pipe(async (files) => {
  await bumpCounter("extras");
  const joined = (
    await Promise.all(files.map((f) => readFile(f.content, "utf-8")))
  )
    .sort()
    .join("|");
  const out = tmpfile();
  await writeFile(out, joined);
  return [{ basename: "extras.bundle", dirname: "__extras__", content: out }];
});

export default query("assets/main/*.txt", { parallel: true })
  .pipe(async ([file]) => {
    await bumpCounter("pre-" + file.basename);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [{ ...file, content: out }];
  })
  .pull(extras)
  .pipe(async (files) => {
    const main = files.find((f) => f.dirname !== "__extras__")!;
    const extra = files.find((f) => f.dirname === "__extras__");
    await bumpCounter("post-" + main.basename);
    const mainRaw = await readFile(main.content, "utf-8");
    const extraRaw = extra ? await readFile(extra.content, "utf-8") : "";
    const out = tmpfile();
    await writeFile(out, mainRaw + "+" + extraRaw);
    return [{ basename: main.basename + ".out", dirname: "", content: out }];
  });
