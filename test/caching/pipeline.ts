import { query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";

export default query("assets/*.txt").pipe(async ([file]) => {
  const counterFile = resolve(__dirname, "counters.json");
  let counts: Record<string, number> = {};
  try {
    counts = JSON.parse(await readFile(counterFile, "utf-8"));
  } catch {
    counts = {};
  }
  
  if (!counts[file.basename]) counts[file.basename] = 0;
  counts[file.basename]++;
  
  await writeFile(counterFile, JSON.stringify(counts));

  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw.toUpperCase() + ` (count: ${counts[file.basename]})`);
  return [{ basename: file.basename + ".out", dirname: "", content: out }];
});
