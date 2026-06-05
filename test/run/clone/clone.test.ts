import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { touchFile } from "../../utils";

describe("clone", () => {
  const baseDir = __dirname;
  const assetsDir = resolve(baseDir, "assets");
  const cacheDir = resolve(baseDir, "cache");
  const outputDir = resolve(baseDir, "output");
  const counterDir = resolve(baseDir, "counters");

  beforeEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterDir, { recursive: true, force: true });
    await mkdir(assetsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterDir, { recursive: true, force: true });
  });

  async function getCounters() {
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

  test("clone of parallel query preserves per-file fanout", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");
    await writeFile(resolve(assetsDir, "c.txt"), "gamma");

    await run({
      entry: resolve(baseDir, "pipeline.ts"),
      outputDirectory: outputDir,
      queryBase: baseDir,
      useWorker: false,
    });

    const outputs = (await readdir(outputDir)).sort();
    expect(outputs).toEqual([
      "a.txt.a",
      "a.txt.b",
      "b.txt.a",
      "b.txt.b",
      "c.txt.a",
      "c.txt.b",
    ]);

    expect(await readFile(resolve(outputDir, "a.txt.a"), "utf-8")).toBe(
      "ALPHA A",
    );
    expect(await readFile(resolve(outputDir, "a.txt.b"), "utf-8")).toBe(
      "ALPHA B",
    );
    expect(await readFile(resolve(outputDir, "b.txt.a"), "utf-8")).toBe(
      "BETA A",
    );
    expect(await readFile(resolve(outputDir, "c.txt.b"), "utf-8")).toBe(
      "GAMMA B",
    );

    expect(await getCounters()).toEqual({
      "source-a.txt": 1,
      "source-b.txt": 1,
      "source-c.txt": 1,
      "cloneA-a.txt": 1,
      "cloneA-b.txt": 1,
      "cloneA-c.txt": 1,
      "cloneB-a.txt": 1,
      "cloneB-b.txt": 1,
      "cloneB-c.txt": 1,
    });
  });

  test("clone slice cache invalidates only the changed file's slice in source and clones", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");
    await writeFile(resolve(assetsDir, "c.txt"), "gamma");

    await run({
      entry: resolve(baseDir, "pipeline.ts"),
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: baseDir,
      useWorker: false,
    });

    expect(await getCounters()).toEqual({
      "source-a.txt": 1,
      "source-b.txt": 1,
      "source-c.txt": 1,
      "cloneA-a.txt": 1,
      "cloneA-b.txt": 1,
      "cloneA-c.txt": 1,
      "cloneB-a.txt": 1,
      "cloneB-b.txt": 1,
      "cloneB-c.txt": 1,
    });

    await touchFile(resolve(assetsDir, "a.txt"), "alpha-changed");

    await run({
      entry: resolve(baseDir, "pipeline.ts"),
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: baseDir,
      useWorker: false,
    });

    expect(await getCounters()).toEqual({
      "source-a.txt": 2,
      "source-b.txt": 1,
      "source-c.txt": 1,
      "cloneA-a.txt": 2,
      "cloneA-b.txt": 1,
      "cloneA-c.txt": 1,
      "cloneB-a.txt": 2,
      "cloneB-b.txt": 1,
      "cloneB-c.txt": 1,
    });

    expect(await readFile(resolve(outputDir, "a.txt.a"), "utf-8")).toBe(
      "ALPHA-CHANGED A",
    );
    expect(await readFile(resolve(outputDir, "b.txt.b"), "utf-8")).toBe(
      "BETA B",
    );
  });

  test("clone of clone preserves per-file fanout through the chain", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");

    await run({
      entry: resolve(baseDir, "pipeline-chain.ts"),
      outputDirectory: outputDir,
      queryBase: baseDir,
      useWorker: false,
    });

    expect((await readdir(outputDir)).sort()).toEqual([
      "a.txt.chained",
      "b.txt.chained",
    ]);

    expect(await readFile(resolve(outputDir, "a.txt.chained"), "utf-8")).toBe(
      "ALPHA/first/second",
    );
    expect(await readFile(resolve(outputDir, "b.txt.chained"), "utf-8")).toBe(
      "BETA/first/second",
    );

    expect(await getCounters()).toEqual({
      "source-a.txt": 1,
      "source-b.txt": 1,
      "first-a.txt": 1,
      "first-b.txt": 1,
      "second-a.txt": 1,
      "second-b.txt": 1,
    });
  });

  test("clone of non-slicing query runs once on source's full result", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");

    await run({
      entry: resolve(baseDir, "pipeline-single.ts"),
      outputDirectory: outputDir,
      queryBase: baseDir,
      useWorker: false,
    });

    expect(await readdir(outputDir)).toEqual(["joined.upper.txt"]);
    const out = await readFile(resolve(outputDir, "joined.upper.txt"), "utf-8");
    expect(out).toBe("ALPHA,BETA");

    expect(await getCounters()).toEqual({ source: 1, cloned: 1 });
  });
});
