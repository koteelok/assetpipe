import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { touchFile } from "../../utils";

describe("groupby-clone-pull-caching", () => {
  const assetsDir = resolve(__dirname, "assets");
  const cacheDir = resolve(__dirname, "cache");
  const outputDir = resolve(__dirname, "output");
  const entry = resolve(__dirname, "pipeline.ts");

  beforeEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(resolve(assetsDir, "tiles"), { recursive: true });
    await mkdir(resolve(assetsDir, "masks"), { recursive: true });
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
  });

  // Regression: a groupBy query that pulls from a cloned parallel pipeline.
  // First cached run produces the full set of outputs (one per group), but on
  // a re-run with no changes only one group's output reaches disk because the
  // groupBy fan-out is bypassed by a stale firstDirtyPull early-return.
  test("groupBy + pulled clone preserves all group outputs on cache hit", async () => {
    await writeFile(resolve(assetsDir, "tiles", "a.tile"), "TA");
    await writeFile(resolve(assetsDir, "tiles", "a.meta"), "MA");
    await writeFile(resolve(assetsDir, "tiles", "b.tile"), "TB");
    await writeFile(resolve(assetsDir, "tiles", "b.meta"), "MB");
    await writeFile(resolve(assetsDir, "tiles", "c.tile"), "TC");
    await writeFile(resolve(assetsDir, "tiles", "c.meta"), "MC");

    await writeFile(resolve(assetsDir, "masks", "1.txt"), "X");
    await writeFile(resolve(assetsDir, "masks", "2.txt"), "Y");

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });

    expect((await readdir(outputDir)).sort()).toEqual([
      "a.out",
      "b.out",
      "c.out",
    ]);
    expect(await readFile(resolve(outputDir, "a.out"), "utf-8")).toBe(
      "TA|MA|X,Y",
    );

    // Second run with no changes — must still produce every group's output.
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });

    expect((await readdir(outputDir)).sort()).toEqual([
      "a.out",
      "b.out",
      "c.out",
    ]);
    expect(await readFile(resolve(outputDir, "a.out"), "utf-8")).toBe(
      "TA|MA|X,Y",
    );
    expect(await readFile(resolve(outputDir, "b.out"), "utf-8")).toBe(
      "TB|MB|X,Y",
    );
    expect(await readFile(resolve(outputDir, "c.out"), "utf-8")).toBe(
      "TC|MC|X,Y",
    );

    // Changing a pulled mask must propagate into every group's output, not
    // just the last group's. Without the fix, firstDirtyPull on a groupBy
    // query took an early-return path that only recomputed one group.
    await touchFile(resolve(assetsDir, "masks", "1.txt"), "X2");

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: __dirname,
      useWorker: false,
    });

    expect(await readFile(resolve(outputDir, "a.out"), "utf-8")).toBe(
      "TA|MA|X2,Y",
    );
    expect(await readFile(resolve(outputDir, "b.out"), "utf-8")).toBe(
      "TB|MB|X2,Y",
    );
    expect(await readFile(resolve(outputDir, "c.out"), "utf-8")).toBe(
      "TC|MC|X2,Y",
    );
  });
});
