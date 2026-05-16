import { File, group, query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";

const counterFile = resolve(__dirname, "counters.json");

let counterChain: Promise<void> = Promise.resolve();
function bumpCounter(name: string): Promise<void> {
  counterChain = counterChain.then(async () => {
    let counts: Record<string, number> = {};
    try {
      counts = JSON.parse(await readFile(counterFile, "utf-8"));
    } catch {}
    counts[name] = (counts[name] ?? 0) + 1;
    await writeFile(counterFile, JSON.stringify(counts));
  });
  return counterChain;
}

async function concat(
  files: readonly File[],
  outName: string,
  suffix: string,
): Promise<File> {
  const parts = await Promise.all(
    files
      .toSorted((a, b) => (a.basename > b.basename ? 1 : -1))
      .map((f) => readFile(f.content, "utf-8")),
  );
  const out = tmpfile();
  await writeFile(out, parts.join("") + suffix);
  return new File(outName, out);
}

const registryPipeline = group()
  .pull(query("assets/metadata/*.txt", { claim: true }))
  .pipe(async (files) => {
    await bumpCounter("registry");
    return [await concat(files, "registry.txt", "|registry")];
  });

const atlasPipeline = group(
  query("assets/textures/*.txt", { claim: true, parallel: true }).pipe(
    async (files) => files,
  ),
)
  .pipe(async (files) => {
    await bumpCounter("generate");
    return [await concat(files, "atlas.txt", "|atlas")];
  })
  .pull(registryPipeline)
  .pipe(async (files) => {
    await bumpCounter("reencode");
    return [await concat(files, "reencoded.txt", "|reencoded")];
  });

export default group(atlasPipeline).pipe(async (files) => {
  await bumpCounter("root");
  return [await concat(files, "out.txt", "|root")];
});
