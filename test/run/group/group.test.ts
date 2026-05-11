import { run } from "@assetpipe/core/runtime";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { expect, test } from "vitest";

test("group(): runs sibling pipelines in parallel and collects all outputs", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "output");

  await run({ entry, outputDirectory, queryBase: __dirname, useWorker: false });

  const resultFiles = await readdir(outputDirectory);
  expect(resultFiles).toContain("texts.txt");
  expect(resultFiles).toContain("jsons.txt");

  const texts = await readFile(resolve(outputDirectory, "texts.txt"), "utf-8");
  // Both txt values should be present (joined by |, order may vary)
  expect(texts).toConsistOf("alpha|beta");

  const jsons = await readFile(resolve(outputDirectory, "jsons.txt"), "utf-8");
  // Both json payloads should be present
  expect(jsons).toConsistOf('{"value":10}|{"value":20}');
});
