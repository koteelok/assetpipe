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

export default query("assets/*.png", { parallel: true })
  .pull(metadata)
  .pipe(async (files) => {
    const png = files.find((f) => f.basename.endsWith(".png"))!;
    await bumpCounter("host-" + stem(png.basename));
    const jsons = files.filter((f) => f.basename.endsWith(".json"));
    const out = tmpfile();
    await writeFile(
      out,
      `${stem(png.basename)}: png=${await readFile(png.content, "utf-8")} jsons=${jsons.length}`,
    );
    return [
      {
        basename: stem(png.basename) + ".combined",
        dirname: "",
        content: out,
      },
    ];
  });
