import { run } from "@assetpipe/core/runtime";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { expect, test } from "vitest";

test(".pull(): combines results from pulled sub-pipelines into the parent pipeline", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "output");

  await run({ entry, outputDirectory, queryBase: __dirname, useWorker: false });

  const resultFiles = await readdir(outputDirectory);
  expect(resultFiles).toContain("manifest.txt");

  const manifest = await readFile(
    resolve(outputDirectory, "manifest.txt"),
    "utf-8",
  );
  const lines = manifest.split("\n").sort();

  // txt sub-pipeline produces .proc files for each .txt input
  expect(lines).toContain("a.txt.proc");
  expect(lines).toContain("b.txt.proc");
  expect(lines).toContain("c.txt.proc");

  // json sub-pipeline produces .dat files for each .json input
  expect(lines).toContain("x.json.dat");
  expect(lines).toContain("y.json.dat");
});
