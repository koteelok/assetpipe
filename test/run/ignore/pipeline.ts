import { group, ignore, path, query, tmpfile } from "@assetpipe/config";
import { writeFile } from "fs/promises";

// ignore() marks assets/excluded/** so those files are hidden from all other pipelines.
// The select pipeline queries ALL assets — if ignore works, skip.txt won't appear.
const ignorePipeline = ignore("assets/excluded/**/*");

const contentPipeline = query("assets/**/*.*").pipe(async (files) => {
  const names = files
    .map((f) => path.basename(f))
    .sort()
    .join("\n");
  const out = tmpfile();
  await writeFile(out, names);
  return [{ target: "filelist.txt", content: out }];
});

export default group(ignorePipeline, contentPipeline);
