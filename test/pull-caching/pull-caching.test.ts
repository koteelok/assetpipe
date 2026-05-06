import { File } from "@assetpipe/config";
import { ExecutionMetadata, run } from "@assetpipe/core/runtime";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { waitForCalls } from "../utils";

describe("pull-caching", () => {
  const assetsDir = resolve(__dirname, "assets");
  const cacheDir = resolve(__dirname, "cache");
  const outputDir = resolve(__dirname, "output");
  const entry = resolve(__dirname, "pipeline.ts");
  const oneJsonPath = resolve(assetsDir, "1.json");
  const twoJsonPath = resolve(assetsDir, "2.json");

  beforeAll(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(assetsDir, { recursive: true });
    await writeFile(oneJsonPath, "[0, 1, 2, 3, 4, 5, 6]");
    await writeFile(twoJsonPath, '["_asdads_"]');
  });

  afterAll(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  });

  test("pulled sub-pipelines are cached and invalidated by their own upstreams", async () => {
    const onOutput =
      vi.fn<(files: File[], metadata?: ExecutionMetadata) => void>();
    const runOnce = () =>
      run({
        entry,
        outputDirectory: outputDir,
        cacheDirectory: cacheDir,
        queryBase: __dirname,
        onOutput,
        useWorker: false,
      });

    // Phase 1 — initial build populates the cache.
    await runOnce();
    let [, metadata] = await waitForCalls(onOutput, 1);
    expect(metadata?.addedFiles.length).toBe(1);
    expect(metadata?.changedFiles.length).toBe(0);
    expect(metadata?.removedFiles.length).toBe(0);
    expect(metadata?.queryTriggers.length).toBe(0);
    expect(await readFile(resolve(outputDir, "bundle.txt"), "utf-8")).toBe(
      "[0]\n[1]\n[2]\n[3]\n[4]\n[5]\n[6]\n0123456_asdads_0123456",
    );

    // Phase 2 — re-run with no changes, the bundle is served from cache.
    await runOnce();
    [, metadata] = await waitForCalls(onOutput, 2);
    expect(metadata?.addedFiles.length).toBe(0);
    expect(metadata?.changedFiles.length).toBe(0);
    expect(metadata?.removedFiles.length).toBe(0);
    expect(metadata?.queryTriggers.length).toBe(0);
    expect(await readFile(resolve(outputDir, "bundle.txt"), "utf-8")).toBe(
      "[0]\n[1]\n[2]\n[3]\n[4]\n[5]\n[6]\n0123456_asdads_0123456",
    );

    // Phase 3 — change an asset that feeds the pulled sub-pipeline; both
    // consumers (the 2.json branch and the chars branch) must reflect it.
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(oneJsonPath, "[7, 8, 9]");
    await new Promise((r) => setTimeout(r, 100));
    await runOnce();
    [, metadata] = await waitForCalls(onOutput, 3);
    expect(metadata?.queryTriggers).toStrictEqual([oneJsonPath]);
    expect(metadata?.addedFiles.length).toBe(0);
    expect(metadata?.changedFiles.length).toBe(1);
    expect(metadata?.removedFiles.length).toBe(0);
    expect(await readFile(resolve(outputDir, "bundle.txt"), "utf-8")).toBe(
      "[7]\n[8]\n[9]\n789_asdads_789",
    );

    // Phase 4 — change an asset only the 2.json branch reads; the pulled
    // sub-pipeline output (the [7]/[8]/[9] lines and the "789" prefix/suffix)
    // remains intact, proving it was served from cache.
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(twoJsonPath, '["_zzz_"]');
    await new Promise((r) => setTimeout(r, 100));
    await runOnce();
    [, metadata] = await waitForCalls(onOutput, 4);
    expect(metadata?.queryTriggers).toStrictEqual([twoJsonPath]);
    expect(metadata?.addedFiles.length).toBe(0);
    expect(metadata?.changedFiles.length).toBe(1);
    expect(metadata?.removedFiles.length).toBe(0);
    expect(await readFile(resolve(outputDir, "bundle.txt"), "utf-8")).toBe(
      "[7]\n[8]\n[9]\n789_zzz_789",
    );
  });
});
