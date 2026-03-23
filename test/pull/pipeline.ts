import { select, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

// The txt pipeline processes each .txt file and adds a .proc extension.
// The json pipeline passes each .json through with a .dat extension.
// The main pipeline pulls from both sub-pipelines, then creates a manifest
// listing all basenames produced.

const txtPipeline = select
  .parallel("assets/txt/*.txt")
  .pipe(async ([file]) => {
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw.toUpperCase());
    return [{ basename: file.basename + ".proc", dirname: "", content: out }];
  });

const jsonPipeline = select
  .parallel("assets/json/*.json")
  .pipe(async ([file]) => {
    const raw = await readFile(file.content, "utf-8");
    const out = tmpfile();
    await writeFile(out, raw);
    return [{ basename: file.basename + ".dat", dirname: "", content: out }];
  });

export default select
  .bulk("assets/txt/*.txt")
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
