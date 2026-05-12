import { query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

const stem = (basename: string) => basename.split(".")[0];

const metadata = query("assets/*.json", { parallel: true });

export default query("assets/*.png", { parallel: true })
  .pull(metadata, {
    match: (sourceSlice, pullSlice) => stem(sourceSlice[0].basename) === stem(pullSlice[0].basename),
  })
  .pipe(async (files) => {
    const png = files.find((f) => f.basename.endsWith(".png"))!;
    const json = files.find((f) => f.basename.endsWith(".json"));
    const pngContent = await readFile(png.content, "utf-8");
    const jsonContent = json ? await readFile(json.content, "utf-8") : "(none)";
    const out = tmpfile();
    await writeFile(
      out,
      `${stem(png.basename)}: png=${pngContent} json=${jsonContent}`,
    );
    return [
      {
        basename: stem(png.basename) + ".combined",
        dirname: "",
        content: out,
      },
    ];
  });
