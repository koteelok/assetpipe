import { query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

const stem = (basename: string) => basename.split(".")[0];

const metadata = query("assets/*.json", { parallel: true });

export default query("assets/*.png", { parallel: true })
  .pull(metadata)
  .pipe(async (files) => {
    const png = files.find((f) => f.basename.endsWith(".png"))!;
    const jsons = files.filter((f) => f.basename.endsWith(".json"));
    const out = tmpfile();
    await writeFile(
      out,
      `${stem(png.basename)}: png=${await readFile(png.content, "utf-8")} jsons=${jsons.length}`,
    );
    return [
      {
        basename: stem(png.basename) + ".broadcast",
        dirname: "",
        content: out,
      },
    ];
  });
