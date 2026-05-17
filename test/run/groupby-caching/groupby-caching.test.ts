import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { removeFile, touchFile } from "../../utils";

describe("groupby caching", () => {
  const assetsDir = resolve(__dirname, "assets");
  const cacheDir = resolve(__dirname, "cache");
  const outputDir = resolve(__dirname, "output");
  const entry = resolve(__dirname, "pipeline.ts");
  const counterDir = resolve(__dirname, "counters");

  beforeEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterDir, { recursive: true, force: true });
    await mkdir(resolve(assetsDir, "alpha"), { recursive: true });
    await mkdir(resolve(assetsDir, "beta"), { recursive: true });
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterDir, { recursive: true, force: true });
  });

  async function getCounts() {
    try {
      const files = await readdir(counterDir);
      const result: Record<string, number> = {};
      for (const f of files) {
        const count = JSON.parse(
          await readFile(resolve(counterDir, f), "utf-8"),
        );
        result[f.replace(".json", "")] = count;
      }
      return result;
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

    await touchFile(resolve(assetsDir, "alpha", "1.txt"), "a1-changed");

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });

    // alpha must recompute, beta must stay cached.
    expect(await getCounts()).toEqual({ alpha: 2, beta: 1 });

    await touchFile(resolve(assetsDir, "beta", "1.txt"), "b1-changed");

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

  test("removing one file from a groupBy group invalidates that group's cache", async () => {
    await writeFile(resolve(assetsDir, "alpha", "1.txt"), "a1");
    await writeFile(resolve(assetsDir, "alpha", "2.txt"), "a2");
    await writeFile(resolve(assetsDir, "beta", "1.txt"), "b1");

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });
    expect(await getCounts()).toEqual({ alpha: 1, beta: 1 });

    await removeFile(resolve(assetsDir, "alpha", "1.txt"));

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });

    // alpha lost a member; its cached output (which embedded a1+a2) is stale
    // and must be recomputed. beta is untouched and stays cached.
    expect(await getCounts()).toEqual({ alpha: 2, beta: 1 });
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
