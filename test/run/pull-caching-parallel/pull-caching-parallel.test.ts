import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("pull-caching with parallel host", () => {
  const baseDir = __dirname;
  const assetsDir = resolve(baseDir, "assets");
  const cacheDir = resolve(baseDir, "cache");
  const outputDir = resolve(baseDir, "output");
  const counterDir = resolve(baseDir, "counters");
  const entry = resolve(baseDir, "pipeline.ts");

  beforeEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterDir, { recursive: true, force: true });
    await mkdir(assetsDir, { recursive: true });
    await writeFile(resolve(assetsDir, "a.png"), "PNG-A");
    await writeFile(resolve(assetsDir, "b.png"), "PNG-B");
    await writeFile(resolve(assetsDir, "c.png"), "PNG-C");
    await writeFile(resolve(assetsDir, "a.json"), "JSON-A");
    await writeFile(resolve(assetsDir, "b.json"), "JSON-B");
    await writeFile(resolve(assetsDir, "c.json"), "JSON-C");
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterDir, { recursive: true, force: true });
  });

  test("parallel host keeps fanout when pulled source goes dirty", async () => {
    const runOnce = () =>
      run({
        entry,
        outputDirectory: outputDir,
        cacheDirectory: cacheDir,
        queryBase: baseDir,
        useWorker: true,
      });

    await runOnce();
    expect((await readdir(outputDir)).sort()).toEqual([
      "a.combined",
      "b.combined",
      "c.combined",
    ]);

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "a.json"), "JSON-A-CHANGED");
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();
    expect((await readdir(outputDir)).sort()).toEqual([
      "a.combined",
      "b.combined",
      "c.combined",
    ]);
  });
});
