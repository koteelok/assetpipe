import { File, query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import { posix } from "path";

// Mirrors the user-reported scenario:
//   - a groupBy query
//   - that pulls a cloned parallel query (`masks.clone().pipe(...)`)
//   - both are unchanged between runs, but on the second run only one group
//     reaches the final transformer.

const masks = query("assets/masks/*.txt", { parallel: true }).pipe(
  async ([file]) => {
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw);
    return [{ ...file, content: out }];
  },
);

export default query("assets/tiles/*.{tile,meta}", {
  groupBy: (file) => posix.basename(file.target).split(".")[0],
})
  .pipe((files) => (files.length === 2 ? files : []))
  .pull(
    masks
      .clone()
      .pipe((files) =>
        files.map((f) => ({
          ...f,
          target: posix.join("__masks__", posix.basename(f.target)),
        })),
      ),
  )
  .pipe(async (files) => {
    let tileFile: File | undefined;
    let metaFile: File | undefined;
    const maskFiles: File[] = [];

    for (const file of files) {
      if (posix.dirname(file.target) === "__masks__") {
        maskFiles.push(file);
      } else if (file.target.endsWith(".tile")) {
        tileFile = file;
      } else if (file.target.endsWith(".meta")) {
        metaFile = file;
      }
    }

    if (!tileFile || !metaFile) return [];

    const tileText = await readFile(tileFile.content, "utf-8");
    const metaText = await readFile(metaFile.content, "utf-8");
    const maskTexts = await Promise.all(
      maskFiles
        .slice()
        .sort((a, b) => (a.target > b.target ? 1 : -1))
        .map((m) => readFile(m.content, "utf-8")),
    );

    const out = tmpfile();
    await writeFile(out, `${tileText}|${metaText}|${maskTexts.join(",")}`);
    return [
      {
        target: tileFile.target.replace(".tile", ".out"),
        content: out,
      },
    ];
  });
