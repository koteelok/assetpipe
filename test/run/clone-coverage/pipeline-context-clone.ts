import { context, query, tmpfile } from "@assetpipe/config";
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

const inner = query("*.txt", { parallel: true }).pipe(async ([file]) => {
  await bumpCounter("inner-" + file.target);
  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw.toUpperCase());
  return [{ ...file, content: out }];
});

// Clone of a context pipeline must produce a usable pipeline whose source is
// the context's already-computed (context-resolved) result.
const ctx = context("assets/nested", inner);

const cloned = ctx.clone().pipe(async (files) => {
  await bumpCounter("ctx-clone");
  const sorted = files
    .slice()
    .sort((a, b) => (a.target > b.target ? 1 : -1));
  const joined = await Promise.all(
    sorted.map(async (f) => {
      const raw = await readFile(f.content, "utf-8");
      return f.target + "=" + raw;
    }),
  );
  const out = tmpfile();
  await writeFile(out, joined.join(","));
  return [{ target: "ctx-out.txt", content: out }];
});

export default cloned;
