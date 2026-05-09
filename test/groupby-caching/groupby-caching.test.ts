import { run } from "@assetpipe/core/runtime";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("groupby caching", () => {
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
    await mkdir(resolve(assetsDir, "alpha"), { recursive: true });
    await mkdir(resolve(assetsDir, "beta"), { recursive: true });
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterFile, { force: true });
  });

  async function getCounts() {
    try {
      return JSON.parse(await readFile(counterFile, "utf-8"));
    } catch {
      return {};
    }
  }

  test("changing one file in a groupBy query only recomputes its group", async () => {
    await writeFile(resolve(assetsDir, "alpha", "1.txt"), "a1");
    await writeFile(resolve(assetsDir, "alpha", "2.txt"), "a2");
    await writeFile(resolve(assetsDir, "beta", "1.txt"), "b1");
    await writeFile(resolve(assetsDir, "beta", "2.txt"), "b2");

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });
    expect(await getCounts()).toEqual({ alpha: 1, beta: 1 });

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "alpha", "1.txt"), "a1-changed");
    await new Promise((r) => setTimeout(r, 100));

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });

    // alpha must recompute, beta must stay cached.
    expect(await getCounts()).toEqual({ alpha: 2, beta: 1 });

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "beta", "1.txt"), "b1-changed");
    await new Promise((r) => setTimeout(r, 100));

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });

    // Only beta this time. alpha must stay cached even though it was the
    // dirty group on the previous run.
    expect(await getCounts()).toEqual({ alpha: 2, beta: 2 });
  });

  test("running an unchanged groupBy query twice doesn't recompute any group", async () => {
    await writeFile(resolve(assetsDir, "alpha", "1.txt"), "a1");
    await writeFile(resolve(assetsDir, "beta", "1.txt"), "b1");

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });
    expect(await getCounts()).toEqual({ alpha: 1, beta: 1 });

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });
    expect(await getCounts()).toEqual({ alpha: 1, beta: 1 });
  });
});
