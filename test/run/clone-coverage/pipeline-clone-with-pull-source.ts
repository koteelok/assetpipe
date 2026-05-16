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
  const concat = (
    await Promise.all(files.map((f) => readFile(f.content, "utf-8")))
  )
    .sort()
    .join("|");
  const out = tmpfile();
  await writeFile(out, concat);
  return [{ target: "extras.bundle", content: out }];
});

// Source has a `pull` in its commands. The clone reads source's resolved
// output (pull-merged files included). Both the pull and the post-pull
// transformer are part of the snapshot the clone consumes.
const source = query("assets/main/*.txt")
  .pull(extras)
  .pipe(async (files) => {
    await bumpCounter("source");
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
    return [{ target: "source.txt", content: out }];
  });

const cloned = source.clone().pipe(async (files) => {
  await bumpCounter("cloned");
  const raw = await readFile(files[0].content, "utf-8");
  const out = tmpfile();
  await writeFile(out, "[" + raw + "]");
  return [{ target: "wrapped.txt", content: out }];
});

export default cloned;
