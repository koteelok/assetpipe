import { group, query, tmpfile } from "@assetpipe/config";
import { File } from "@assetpipe/core/types";
import { writeFile } from "fs/promises";

// query with claim takes ownership of *.txt files.
// A subsequent query for the same glob should see no files because
// they were already claimed.

const claimPipeline = query("assets/*.txt", { claim: true }).pipe(
  async (files) => {
    const names = files
      .map((f) => f.basename)
      .sort()
      .join(",");
    const out = tmpfile();
    await writeFile(out, `claimed:${names}`);
    return [new File({ target: "claimed.txt", content: out })];
  },
);

const selectPipeline = query("assets/*.txt").pipe(async (files) => {
  const names = files
    .map((f) => f.basename)
    .sort()
    .join(",");
  const out = tmpfile();
  await writeFile(out, `selected:${names}`);
  return [new File({ target: "selected.txt", content: out })];
});

export default group(claimPipeline, selectPipeline);
