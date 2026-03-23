import { run } from "@assetpipe/core/runtime";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { expect, test } from "vitest";

test("claim: claim.bulk() takes ownership so a later select on the same glob sees no files", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "output");
  const cacheDirectory = resolve(__dirname, "cache");

  await run({ entry, outputDirectory, cacheDirectory, useWorker: false });

  const resultFiles = await readdir(outputDirectory);
  expect(resultFiles).toContain("claimed.txt");
  expect(resultFiles).toContain("selected.txt");

  const claimed = await readFile(resolve(outputDirectory, "claimed.txt"), "utf-8");
  const selected = await readFile(resolve(outputDirectory, "selected.txt"), "utf-8");

  // The claim pipeline should have received all three txt files
  expect(claimed).toContain("claimed:");
  const claimedFiles = claimed.replace("claimed:", "").split(",");
  expect(claimedFiles.sort()).toEqual(["a.txt", "b.txt", "c.txt"]);

  // The select pipeline should have received no files (no content after the prefix)
  expect(selected).toBe("selected:");
});
