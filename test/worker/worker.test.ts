import { run } from "@assetpipe/core/runtime";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { expect, test } from "vitest";

test("useWorker: true", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "result");
  const cacheDirectory = resolve(__dirname, "cache");

  await run({ entry, outputDirectory, cacheDirectory, useWorker: true });

  const resultFiles = await readdir(outputDirectory);

  expect(resultFiles).toContain("file.txt");

  const fileContent = await readFile(
    resolve(outputDirectory, "file.txt"),
    "utf-8",
  );

  expect(fileContent).toConsistOf("1 | 2 | 3 | 4");
});
