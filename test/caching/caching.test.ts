import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("caching", () => {
  const assetsDir = resolve(__dirname, "assets");
  const cacheDir = resolve(__dirname, "cache");
  const outputDir = resolve(__dirname, "output");
  const entry = resolve(__dirname, "pipeline.ts");
  const counterFile = resolve(__dirname, "counters.json");

  beforeEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterFile, { force: true });
    await mkdir(assetsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterFile, { force: true });

    // reset pipeline content just in case
    const content = await readFile(entry, "utf-8");
    if (content.includes("// changed config")) {
      await writeFile(entry, content.replace("\n// changed config", ""));
    }
  });

  async function getCallCounts() {
    try {
      return JSON.parse(await readFile(counterFile, "utf-8"));
    } catch {
      return {};
    }
  }

  test("running the same pipeline multiple times doesn't inflate the cache and returns the same paths", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");

    // First run
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      useWorker: false,
    });
    expect(await getCallCounts()).toEqual({ "a.txt": 1, "b.txt": 1 });

    const cacheHashes = (await readdir(cacheDir)).filter((x) => x !== "jiti");
    const cacheHashDir = resolve(cacheDir, cacheHashes[0]);
    const cacheTempFiles = await readdir(resolve(cacheHashDir, "temp"));
    const cacheSize1 = cacheTempFiles.length;

    const outputA1 = await readFile(resolve(outputDir, "a.txt.out"), "utf-8");
    const outputB1 = await readFile(resolve(outputDir, "b.txt.out"), "utf-8");

    // Second run
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      useWorker: false,
    });

    // Call counts should not increase because of cache hit
    expect(await getCallCounts()).toEqual({ "a.txt": 1, "b.txt": 1 });

    const cacheTempFiles2 = await readdir(resolve(cacheHashDir, "temp"));
    expect(cacheTempFiles2.length).toBe(cacheSize1); // Doesn't inflate cache

    const outputA2 = await readFile(resolve(outputDir, "a.txt.out"), "utf-8");
    const outputB2 = await readFile(resolve(outputDir, "b.txt.out"), "utf-8");

    expect(outputA1).toBe(outputA2);
    expect(outputB1).toBe(outputB2);
  });

  test("when 1 asset changed, only changed asset gets recomputed", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");

    // First run
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      useWorker: false,
    });
    expect(await getCallCounts()).toEqual({ "a.txt": 1, "b.txt": 1 });

    // Modify one asset
    await new Promise((r) => setTimeout(r, 100)); // wait for watcher if any
    await writeFile(resolve(assetsDir, "a.txt"), "alpha-changed");
    await new Promise((r) => setTimeout(r, 100));

    // Second run
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      useWorker: false,
    });

    // Only a.txt should be recomputed
    expect(await getCallCounts()).toEqual({ "a.txt": 2, "b.txt": 1 });

    const outputA = await readFile(resolve(outputDir, "a.txt.out"), "utf-8");
    const outputB = await readFile(resolve(outputDir, "b.txt.out"), "utf-8");

    expect(outputA).toBe("ALPHA-CHANGED (count: 2)");
    expect(outputB).toBe("BETA (count: 1)");
  });

  test("changing pipeline file (config) revalidates whole pipeline", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");

    // First run
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      useWorker: false,
    });
    expect(await getCallCounts()).toEqual({ "a.txt": 1, "b.txt": 1 });

    // Touch the pipeline file to change its modification time
    await new Promise((r) => setTimeout(r, 100));
    const content = await readFile(entry, "utf-8");
    await writeFile(entry, content + "\n// changed config");
    await new Promise((r) => setTimeout(r, 100));

    // Second run
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      useWorker: false,
    });

    // Should recompute because pipeline file changed
    expect(await getCallCounts()).toEqual({ "a.txt": 2, "b.txt": 2 });
  });
});
