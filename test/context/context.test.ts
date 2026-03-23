import { run } from "@assetpipe/core/runtime";
import { readdir,readFile } from "fs/promises";
import { resolve } from "path";
import { expect, test } from "vitest";

test("context(): resolves inner pipeline queries relative to the given root", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "output");
  const cacheDirectory = resolve(__dirname, "cache");

  await run({ entry, outputDirectory, cacheDirectory, useWorker: false });

  const resultFiles = await readdir(outputDirectory);
  expect(resultFiles).toContain("ctx_output.txt");

  const content = await readFile(
    resolve(outputDirectory, "ctx_output.txt"),
    "utf-8",
  );

  // All three txt values should be present, joined by |, sorted
  expect(content).toConsistOf("alpha|beta|gamma");
});
