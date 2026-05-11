import { run } from "@assetpipe/core/runtime";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { expect, test } from "vitest";

test("query: processes each file individually", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "output");

  await run({ entry, outputDirectory, queryBase: __dirname, useWorker: false });

  const resultFiles = await readdir(outputDirectory);
  expect(resultFiles.sort()).toEqual(["a.txt.out", "b.txt.out", "c.txt.out"]);

  // Each output is the uppercased version of its input
  expect(await readFile(resolve(outputDirectory, "a.txt.out"), "utf-8")).toBe(
    "ALPHA",
  );
  expect(await readFile(resolve(outputDirectory, "b.txt.out"), "utf-8")).toBe(
    "BETA",
  );
  expect(await readFile(resolve(outputDirectory, "c.txt.out"), "utf-8")).toBe(
    "GAMMA",
  );
});
