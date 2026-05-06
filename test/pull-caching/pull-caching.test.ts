import { File } from "@assetpipe/config";
import { ExecutionMetadata, run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { waitForCalls } from "../utils";

describe("caching", () => {
  const assetsDir = resolve(__dirname, "assets");
  const cacheDir = resolve(__dirname, "cache");
  const outputDir = resolve(__dirname, "output");
  const entry = resolve(__dirname, "pipeline.ts");

  beforeEach(async () => {
    // await rm(cacheDir, { recursive: true, force: true });
    // await rm(outputDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    // await rm(cacheDir, { recursive: true, force: true });
    // await rm(outputDir, { recursive: true, force: true });
  });

  test("", async () => {
    const onOutput =
      vi.fn<(files: File[], metadata?: ExecutionMetadata) => void>();

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      onOutput,
      useWorker: false,
    });

    // let [, metadata] = await waitForCalls(onOutput, 1);
    // expect(metadata).toBeDefined();
    // expect(metadata?.addedFiles.length).toBe(2);
    // expect(metadata?.changedFiles.length).toBe(0);
    // expect(metadata?.removedFiles.length).toBe(0);
    // expect(metadata?.queryTriggers.length).toBe(0);
  });
});
