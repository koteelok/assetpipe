import { File, group, query, tmpfile } from "@assetpipe/config";
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

const left = query("assets/left/*.txt", { parallel: true }).pipe(
  async ([file]) => {
    await bumpCounter("left-" + file.basename);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [file.withContent(out)];
  },
);

const right = query("assets/right/*.txt", { parallel: true }).pipe(
  async ([file]) => {
    await bumpCounter("right-" + file.basename);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [file.withContent(out)];
  },
);

// Clone of a group: the clone takes the group's merged output and runs
// further commands. Must invoke clone() on the GroupPipeline kind, not
// QueryPipeline.
const combined = group(left, right);

const cloned = combined.clone().pipe(async (files) => {
  await bumpCounter("group-clone");
  const sorted = files.toSorted((a, b) => (a.basename > b.basename ? 1 : -1));
  const joined = await Promise.all(
    sorted.map(async (f) => {
      const raw = await readFile(f.content, "utf-8");
      return f.basename + "=" + raw;
    }),
  );
  const out = tmpfile();
  await writeFile(out, joined.join(","));
  return [new File({ target: "merged.txt", content: out })];
});

export default cloned;
