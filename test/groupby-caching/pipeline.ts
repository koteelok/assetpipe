import { query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";

export default query("assets/**/*.txt", {
  groupBy: (file) => file.dirname,
}).pipe(async (files) => {
  const counterFile = resolve(__dirname, "counters.json");
  let counts: Record<string, number> = {};
  try {
    counts = JSON.parse(await readFile(counterFile, "utf-8"));
  } catch {
    counts = {};
  }

  const tag = files[0].dirname;
  counts[tag] = (counts[tag] ?? 0) + 1;
  await writeFile(counterFile, JSON.stringify(counts));

  const texts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  const out = tmpfile();
  await writeFile(out, texts.join("\n"));
  return [{ basename: `${tag}.bundle`, dirname: "", content: out }];
});
