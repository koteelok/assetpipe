import { run } from "@assetpipe/core/runtime";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { expect, test } from "vitest";

test("ignore(): excludes matched files from all other pipelines", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "output");

  await run({ entry, outputDirectory, queryBase: __dirname, useWorker: false });

  const resultFiles = await readdir(outputDirectory);
  expect(resultFiles).toContain("filelist.txt");

  const filelist = await readFile(
    resolve(outputDirectory, "filelist.txt"),
    "utf-8",
  );

  // The excluded file must NOT appear
  expect(filelist).not.toContain("skip.txt");

  // Non-excluded files should still be listed
  expect(filelist).toContain("a.txt");
  expect(filelist).toContain("b.txt");
  expect(filelist).toContain("x.json");
});
