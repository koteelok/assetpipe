import { claim, group, select, tmpfile } from "@assetpipe/config";
import { writeFile } from "fs/promises";

// claim.bulk() takes ownership of *.txt files.
// A subsequent select.bulk() for the same glob should see no files because
// they were already claimed.

const claimPipeline = claim.bulk("assets/*.txt").pipe(async (files) => {
  const names = files
    .map((f) => f.basename)
    .sort()
    .join(",");
  const out = tmpfile();
  await writeFile(out, `claimed:${names}`);
  return [{ basename: "claimed.txt", dirname: "", content: out }];
});

const selectPipeline = select
  .bulk("assets/*.txt")
  .pipe(async (files) => {
    const names = files
      .map((f) => f.basename)
      .sort()
      .join(",");
    const out = tmpfile();
    await writeFile(out, `selected:${names}`);
    return [{ basename: "selected.txt", dirname: "", content: out }];
  });

export default group(claimPipeline, selectPipeline);
