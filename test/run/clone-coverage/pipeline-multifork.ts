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

const source = query("assets/*.txt", { parallel: true }).pipe(
  async ([file]) => {
    await bumpCounter("source-" + file.basename);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [file.withContent(out)];
  },
);

function makeChild(parent: typeof source, tag: string) {
  return parent.clone().pipe(async ([file]) => {
    await bumpCounter(tag + "-" + file.basename);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw + "/" + tag);
    return [new File({ basename: file.basename, dirname: tag, content: out })];
  });
}

// Three direct clones of source, plus two clones-of-a-clone.
const cA = makeChild(source, "cA");
const cB = makeChild(source, "cB");
const cC = makeChild(source, "cC");
const cAA = makeChild(cA, "cAA");
const cAB = makeChild(cA, "cAB");

export default group(cA, cB, cC, cAA, cAB);
