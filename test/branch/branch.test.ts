import { run } from "@assetpipe/core/runtime";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { expect, test } from "vitest";

test(".branch(): fans input into multiple transformers and merges all results", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "output");

  await run({ entry, outputDirectory, useWorker: false });

  const resultFiles = await readdir(outputDirectory);

  // Both upper_ and lower_ variants should exist for all three inputs
  expect(resultFiles).toContain("upper_a.txt");
  expect(resultFiles).toContain("upper_b.txt");
  expect(resultFiles).toContain("upper_c.txt");
  expect(resultFiles).toContain("lower_a.txt");
  expect(resultFiles).toContain("lower_b.txt");
  expect(resultFiles).toContain("lower_c.txt");

  expect(await readFile(resolve(outputDirectory, "upper_a.txt"), "utf-8")).toBe(
    "ALPHA",
  );
  expect(await readFile(resolve(outputDirectory, "lower_a.txt"), "utf-8")).toBe(
    "alpha",
  );
  expect(await readFile(resolve(outputDirectory, "upper_b.txt"), "utf-8")).toBe(
    "BETA",
  );
  expect(await readFile(resolve(outputDirectory, "lower_b.txt"), "utf-8")).toBe(
    "beta",
  );
  expect(await readFile(resolve(outputDirectory, "upper_c.txt"), "utf-8")).toBe(
    "GAMMA",
  );
  expect(await readFile(resolve(outputDirectory, "lower_c.txt"), "utf-8")).toBe(
    "gamma",
  );
});
