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
    await bumpCounter("source-" + file.target);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [{ ...file, content: out }];
  },
);

// Three back-to-back clones with no pipe in between, then one pipe.
// Must still produce per-file fanout, and source must not re-run because
// of the extra clone layers.
const final = source
  .clone()
  .clone()
  .clone()
  .pipe(async ([file]) => {
    await bumpCounter("final-" + file.target);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw + "/triple");
    return [{ ...file, target: file.target + ".out", content: out }];
  });

export default final;
