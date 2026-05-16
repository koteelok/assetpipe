import { query, tmpfile } from "@assetpipe/config";
import { mkdir, readFile, writeFile } from "fs/promises";
import { posix, resolve } from "path";

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
  return [{ target: "__extras__/extras.bundle", content: out }];
});

export default query("assets/main/*.{a,b}", {
  groupBy: (file) => posix.basename(file.target).split(".")[0],
})
  .pipe(async (files) => {
    const tag = posix
      .basename(
        files.find((f) => posix.dirname(f.target) !== "__extras__")!.target,
      )
      .split(".")[0];
    await bumpCounter("pre-" + tag);
    const sorted = files
      .slice()
      .sort((a, b) => (a.target > b.target ? 1 : -1));
    const joined = await Promise.all(
      sorted.map(async (f) => {
        const raw = await readFile(f.content, "utf-8");
        return posix.basename(f.target) + "=" + raw.toUpperCase();
      }),
    );
    const out = tmpfile();
    await writeFile(out, joined.join(","));
    return [{ target: tag + ".pre", content: out }];
  })
  .pull(extras)
  .pipe(async (files) => {
    const main = files.find((f) => posix.dirname(f.target) !== "__extras__")!;
    const extra = files.find((f) => posix.dirname(f.target) === "__extras__");
    const tag = posix.basename(main.target).split(".")[0];
    await bumpCounter("post-" + tag);
    const mainRaw = await readFile(main.content, "utf-8");
    const extraRaw = extra ? await readFile(extra.content, "utf-8") : "";
    const out = tmpfile();
    await writeFile(out, mainRaw + "+" + extraRaw);
    return [{ target: tag + ".out", content: out }];
  });
