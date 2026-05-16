import { File, query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const ASSETS = path.join(__dirname, "assets/*.txt").replace(/\\/g, "/");

export default query(ASSETS, { parallel: true }).pipe(async ([file]) => {
  const out = tmpfile();
  await writeFile(out, await readFile(file.content, "utf-8"));
  return [new File(file.basename, out)];
});
