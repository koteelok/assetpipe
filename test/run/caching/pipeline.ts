import { query, tmpfile } from "@assetpipe/config";
import { File } from "@assetpipe/core/types";
import { mkdir, readFile, writeFile } from "fs/promises";
import { resolve } from "path";

export default query("assets/*.txt", { parallel: true }).pipe(async ([file]) => {
  const counterDir = resolve(__dirname, "counters");
  await mkdir(counterDir, { recursive: true });
  const counterFile = resolve(counterDir, file.basename + ".json");
  let count = 0;
  try {
    count = JSON.parse(await readFile(counterFile, "utf-8"));
  } catch {}
  count++;
  await writeFile(counterFile, JSON.stringify(count));

  const raw = await readFile(file.content, "utf-8");
  const out = tmpfile();
  await writeFile(out, raw.toUpperCase() + ` (count: ${count})`);
  return [new File(file.basename + ".out", out)];
});
