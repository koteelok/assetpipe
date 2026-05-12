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

const stem = (basename: string) => basename.split(".")[0];

const metadata = query("assets/*.json", { parallel: true }).pipe(
  async ([file]) => {
    await bumpCounter("meta-" + stem(file.basename));
    return [file];
  },
);

export default query("assets/**/*.png", {
  groupBy: (file) => file.dirname,
})
  .pull(metadata, {
    match: (sourceSlice, pullSlice) =>
      stem(sourceSlice[0].basename) === pullSlice[0].dirname,
  })
  .pipe(async (files) => {
    const pngs = files
      .filter((f) => f.basename.endsWith(".png"))
      .sort((a, b) => a.basename.localeCompare(b.basename));
    const jsons = files
      .filter((f) => f.basename.endsWith(".json"))
      .sort((a, b) => a.basename.localeCompare(b.basename));
    const tag = pngs[0].dirname;
    await bumpCounter("host-" + tag);
    const jsonContent =
      jsons.length === 0
        ? "(none)"
        : (
            await Promise.all(jsons.map((j) => readFile(j.content, "utf-8")))
          ).join("+");
    const out = tmpfile();
    await writeFile(
      out,
      `${tag}: pngs=${pngs.length} jsons=${jsons.length} json=${jsonContent}`,
    );
    return [
      {
        basename: tag + ".bundle",
        dirname: "",
        content: out,
      },
    ];
  });
