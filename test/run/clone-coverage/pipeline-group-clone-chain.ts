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

// Chain of group clones: group -> clone+pipe -> clone+pipe -> clone+pipe.
const combined = group(left, right);

const step1 = combined.clone().pipe(async (files) => {
  await bumpCounter("step1");
  const sorted = files.toSorted((a, b) =>
    a.basename > b.basename ? 1 : -1,
  );
  const joined = await Promise.all(
    sorted.map(async (f) => {
      const raw = await readFile(f.content, "utf-8");
      return raw;
    }),
  );
  const out = tmpfile();
  await writeFile(out, joined.join(","));
  return [new File("step1.txt", out)];
});

const step2 = step1.clone().pipe(async (files) => {
  await bumpCounter("step2");
  const raw = await readFile(files[0].content, "utf-8");
  const out = tmpfile();
  await writeFile(out, "<" + raw + ">");
  return [new File("step2.txt", out)];
});

const step3 = step2.clone().pipe(async (files) => {
  await bumpCounter("step3");
  const raw = await readFile(files[0].content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw + "!");
  return [new File("step3.txt", out)];
});

export default step3;
