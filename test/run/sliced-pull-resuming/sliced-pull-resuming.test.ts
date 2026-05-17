import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { touchFile } from "../../utils";

describe("sliced-pull-resuming", () => {
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
    await mkdir(resolve(assetsDir, "main"), { recursive: true });
    await mkdir(resolve(assetsDir, "extras"), { recursive: true });
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
        result[f.replace(".json", "")] = JSON.parse(
          await readFile(resolve(counterDir, f), "utf-8"),
        );
      }
      return result;
    } catch {
      return {};
    }
  }

  async function runPipeline(entry: string) {
    await run({
      entry: resolve(baseDir, entry),
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: baseDir,
      useWorker: false,
    });
  }

  async function modify(relativePath: string, content: string) {
    await touchFile(resolve(assetsDir, relativePath), content);
  }

  test("parallel: dirty pull recomputes only post-pull commands per slice", async () => {
    await writeFile(resolve(assetsDir, "main", "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "main", "b.txt"), "beta");
    await writeFile(resolve(assetsDir, "main", "c.txt"), "gamma");
    await writeFile(resolve(assetsDir, "extras", "e1.txt"), "e1");
    await writeFile(resolve(assetsDir, "extras", "e2.txt"), "e2");

    // Phase 1 — cold run; every stage executes once per slice.
    await runPipeline("pipeline-parallel.ts");
    expect((await readdir(outputDir)).sort()).toEqual([
      "a.txt.out",
      "b.txt.out",
      "c.txt.out",
    ]);
    expect(await readFile(resolve(outputDir, "a.txt.out"), "utf-8")).toBe(
      "ALPHA+e1|e2",
    );
    expect(await getCounters()).toEqual({
      extras: 1,
      "pre-a.txt": 1,
      "pre-b.txt": 1,
      "pre-c.txt": 1,
      "post-a.txt": 1,
      "post-b.txt": 1,
      "post-c.txt": 1,
    });

    // Phase 2 — no changes; everything cache-hits, nothing re-runs.
    await runPipeline("pipeline-parallel.ts");
    expect(await getCounters()).toEqual({
      extras: 1,
      "pre-a.txt": 1,
      "pre-b.txt": 1,
      "pre-c.txt": 1,
      "post-a.txt": 1,
      "post-b.txt": 1,
      "post-c.txt": 1,
    });

    // Phase 3 — modify an extras file (a pulled sub-pipeline source). Each
    // slice's pre-pull output is unaffected: only post-pull commands need to
    // re-run per slice. The optimization stores pre-pull state per slice.
    await modify("extras/e1.txt", "e1-2");
    await runPipeline("pipeline-parallel.ts");
    expect(await readFile(resolve(outputDir, "a.txt.out"), "utf-8")).toBe(
      "ALPHA+e1-2|e2",
    );
    expect(await readFile(resolve(outputDir, "b.txt.out"), "utf-8")).toBe(
      "BETA+e1-2|e2",
    );
    expect(await readFile(resolve(outputDir, "c.txt.out"), "utf-8")).toBe(
      "GAMMA+e1-2|e2",
    );
    expect(await getCounters()).toEqual({
      extras: 2,
      "pre-a.txt": 1,
      "pre-b.txt": 1,
      "pre-c.txt": 1,
      "post-a.txt": 2,
      "post-b.txt": 2,
      "post-c.txt": 2,
    });

    // Phase 4 — modify one main file; only that slice's pre+post re-runs,
    // and extras stays cached.
    await modify("main/a.txt", "alpha-2");
    await runPipeline("pipeline-parallel.ts");
    expect(await readFile(resolve(outputDir, "a.txt.out"), "utf-8")).toBe(
      "ALPHA-2+e1-2|e2",
    );
    expect(await getCounters()).toEqual({
      extras: 2,
      "pre-a.txt": 2,
      "pre-b.txt": 1,
      "pre-c.txt": 1,
      "post-a.txt": 3,
      "post-b.txt": 2,
      "post-c.txt": 2,
    });
  });

  test("groupBy: dirty pull recomputes only post-pull commands per group", async () => {
    await writeFile(resolve(assetsDir, "main", "x.a"), "xa");
    await writeFile(resolve(assetsDir, "main", "x.b"), "xb");
    await writeFile(resolve(assetsDir, "main", "y.a"), "ya");
    await writeFile(resolve(assetsDir, "main", "y.b"), "yb");
    await writeFile(resolve(assetsDir, "extras", "e1.txt"), "e1");
    await writeFile(resolve(assetsDir, "extras", "e2.txt"), "e2");

    // Phase 1 — cold run; every stage runs once per group.
    await runPipeline("pipeline-groupby.ts");
    expect((await readdir(outputDir)).sort()).toEqual(["x.out", "y.out"]);
    expect(await readFile(resolve(outputDir, "x.out"), "utf-8")).toBe(
      "x.a=XA,x.b=XB+e1|e2",
    );
    expect(await getCounters()).toEqual({
      extras: 1,
      "pre-x": 1,
      "pre-y": 1,
      "post-x": 1,
      "post-y": 1,
    });

    // Phase 2 — no changes.
    await runPipeline("pipeline-groupby.ts");
    expect(await getCounters()).toEqual({
      extras: 1,
      "pre-x": 1,
      "pre-y": 1,
      "post-x": 1,
      "post-y": 1,
    });

    // Phase 3 — modify an extras file. Groups' pre-pull outputs unchanged;
    // only post-pull must re-run per group.
    await modify("extras/e1.txt", "e1-2");
    await runPipeline("pipeline-groupby.ts");
    expect(await readFile(resolve(outputDir, "x.out"), "utf-8")).toBe(
      "x.a=XA,x.b=XB+e1-2|e2",
    );
    expect(await readFile(resolve(outputDir, "y.out"), "utf-8")).toBe(
      "y.a=YA,y.b=YB+e1-2|e2",
    );
    expect(await getCounters()).toEqual({
      extras: 2,
      "pre-x": 1,
      "pre-y": 1,
      "post-x": 2,
      "post-y": 2,
    });

    // Phase 4 — modify one group's main file; only that group's pre+post
    // re-runs.
    await modify("main/x.a", "xa-2");
    await runPipeline("pipeline-groupby.ts");
    expect(await readFile(resolve(outputDir, "x.out"), "utf-8")).toBe(
      "x.a=XA-2,x.b=XB+e1-2|e2",
    );
    expect(await getCounters()).toEqual({
      extras: 2,
      "pre-x": 2,
      "pre-y": 1,
      "post-x": 3,
      "post-y": 2,
    });
  });
});
