import { run } from "@assetpipe/core/runtime";
import { readdir, readFile, rm } from "fs/promises";
import { resolve } from "path";
import { afterEach, expect, test } from "vitest";

test("query: exact paths instead of globs should work", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "output");

  await run({ entry, outputDirectory, queryBase: __dirname, useWorker: false });

  const resultFiles = await readdir(outputDirectory);
  expect(resultFiles).toContain("ctx_output.txt");

  const content = await readFile(
    resolve(outputDirectory, "ctx_output.txt"),
    "utf-8",
  );

  expect(content).toConsistOf("[alpha]|(beta)|{gamma}");
});

afterEach(async () => {
  await rm(resolve(__dirname, "output"), { recursive: true, force: true });
});
