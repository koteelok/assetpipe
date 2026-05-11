import { query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

// The txt pipeline processes each .txt file and adds a .proc extension.
// The json pipeline passes each .json through with a .dat extension.
// The main pipeline pulls from both sub-pipelines, then creates a manifest
// listing all basenames produced.

const txtPipeline = query("assets/txt/*.txt", { parallel: true })
  .pipe(async ([file]) => {
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [{ basename: file.basename + ".proc", dirname: "", content: out }];
  });

const jsonPipeline = query("assets/json/*.json", { parallel: true })
  .pipe(async ([file]) => {
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw);
    return [{ basename: file.basename + ".dat", dirname: "", content: out }];
  });

export default query("assets/txt/*.txt")
  .pull(txtPipeline, jsonPipeline)
  .pipe(async (files) => {
    const basenames = files
      .map((f) => f.basename)
      .sort()
      .join("\n");
    const out = tmpfile();
    await writeFile(out, basenames);
    return [{ basename: "manifest.txt", dirname: "", content: out }];
  });
