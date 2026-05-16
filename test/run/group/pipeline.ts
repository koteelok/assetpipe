import { group, query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";

// Two sibling pipelines combined with group().
// txtPipeline handles *.txt, jsonPipeline handles *.json.
// Both run independently; group() collects all their outputs together.

const txtPipeline = query("assets/txt/*.txt").pipe(async (files) => {
  const texts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  const out = tmpfile();
  await writeFile(out, texts.join("|"));
  return [{ target: "texts.txt", content: out }];
});

const jsonPipeline = query("assets/json/*.json").pipe(async (files) => {
  const texts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  const out = tmpfile();
  await writeFile(out, texts.join("|"));
  return [{ target: "jsons.txt", content: out }];
});

export default group(txtPipeline, jsonPipeline);
