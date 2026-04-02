import { group, query, tmpfile } from "@assetpipe/config";
import { writeFile } from "fs/promises";

// query with claim takes ownership of *.txt files.
// A subsequent query for the same glob should see no files because
// they were already claimed.

const claimPipeline = query("assets/*.txt", { claim: true, bulk: true }).pipe(async (files) => {
  const names = files
    .map((f) => f.basename)
    .sort()
    .join(",");
  const out = tmpfile();
  await writeFile(out, `claimed:${names}`);
  return [{ basename: "claimed.txt", dirname: "", content: out }];
});

const selectPipeline = query("assets/*.txt", { bulk: true })
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
