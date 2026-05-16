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

const left = query("assets/left/*.txt", { parallel: true }).pipe(
  async ([file]) => {
    await bumpCounter("left-" + file.target);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [{ ...file, content: out }];
  },
);

const right = query("assets/right/*.txt", { parallel: true }).pipe(
  async ([file]) => {
    await bumpCounter("right-" + file.target);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [{ ...file, content: out }];
  },
);

// Chain of group clones: group -> clone+pipe -> clone+pipe -> clone+pipe.
const combined = group(left, right);

const step1 = combined.clone().pipe(async (files) => {
  await bumpCounter("step1");
  const sorted = files
    .slice()
    .sort((a, b) => (a.target > b.target ? 1 : -1));
  const joined = await Promise.all(
    sorted.map(async (f) => {
      const raw = await readFile(f.content, "utf-8");
      return raw;
    }),
  );
  const out = tmpfile();
  await writeFile(out, joined.join(","));
  return [{ target: "step1.txt", content: out }];
});

const step2 = step1.clone().pipe(async (files) => {
  await bumpCounter("step2");
  const raw = await readFile(files[0].content, "utf-8");
  const out = tmpfile();
  await writeFile(out, "<" + raw + ">");
  return [{ target: "step2.txt", content: out }];
});

const step3 = step2.clone().pipe(async (files) => {
  await bumpCounter("step3");
  const raw = await readFile(files[0].content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw + "!");
  return [{ target: "step3.txt", content: out }];
});

export default step3;
