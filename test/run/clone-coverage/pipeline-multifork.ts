import { group, query, tmpfile } from "@assetpipe/config";
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

const source = query("assets/*.txt", { parallel: true }).pipe(
  async ([file]) => {
    await bumpCounter("source-" + file.target);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [{ ...file, content: out }];
  },
);

function makeChild(parent: typeof source, tag: string) {
  return parent.clone().pipe(async ([file]) => {
    const basename = posix.basename(file.target);
    await bumpCounter(tag + "-" + basename);
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw + "/" + tag);
    return [{ target: posix.join(tag, basename), content: out }];
  });
}

// Three direct clones of source, plus two clones-of-a-clone.
const cA = makeChild(source, "cA");
const cB = makeChild(source, "cB");
const cC = makeChild(source, "cC");
const cAA = makeChild(cA, "cAA");
const cAB = makeChild(cA, "cAB");

export default group(cA, cB, cC, cAA, cAB);
