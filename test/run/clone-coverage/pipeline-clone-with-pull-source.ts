import { File, query, tmpfile } from "@assetpipe/config";
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
  const concat = (
    await Promise.all(files.map((f) => readFile(f.content, "utf-8")))
  )
    .sort()
    .join("|");
  const out = tmpfile();
  await writeFile(out, concat);
  return [new File(posix.join("__extras__", "extras.bundle"), out)];
});

// Source has a `pull` in its commands. The clone reads source's resolved
// output (pull-merged files included). Both the pull and the post-pull
// transformer are part of the snapshot the clone consumes.
const source = query("assets/main/*.txt")
  .pull(extras)
  .pipe(async (files) => {
    await bumpCounter("source");
    const sorted = files.toSorted((a, b) =>
      a.basename > b.basename ? 1 : -1,
    );
    const joined = await Promise.all(
      sorted.map(async (f) => {
        const raw = await readFile(f.content, "utf-8");
        return f.basename + "=" + raw;
      }),
    );
    const out = tmpfile();
    await writeFile(out, joined.join(","));
    return [new File("source.txt", out)];
  });

const cloned = source.clone().pipe(async (files) => {
  await bumpCounter("cloned");
  const raw = await readFile(files[0].content, "utf-8");
  const out = tmpfile();
  await writeFile(out, "[" + raw + "]");
  return [new File("wrapped.txt", out)];
});

export default cloned;
