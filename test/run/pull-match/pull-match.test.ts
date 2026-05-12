import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("pull match", () => {
  const baseDir = __dirname;
  const assetsDir = resolve(baseDir, "assets");
  const outputDir = resolve(baseDir, "output");

  beforeEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
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
    await rm(outputDir, { recursive: true, force: true });
  });

  test("match zips parallel slices by predicate so each host slice sees only its match", async () => {
    await run({
      entry: resolve(baseDir, "pipeline.ts"),
      outputDirectory: outputDir,
      queryBase: baseDir,
      useWorker: false,
    });

    const outputs = (await readdir(outputDir)).sort();
    expect(outputs).toEqual(["a.combined", "b.combined", "c.combined"]);

    expect(await readFile(resolve(outputDir, "a.combined"), "utf-8")).toBe(
      "a: png=PNG-A json=JSON-A pulled=2",
    );
    expect(await readFile(resolve(outputDir, "b.combined"), "utf-8")).toBe(
      "b: png=PNG-B json=JSON-B pulled=2",
    );
    expect(await readFile(resolve(outputDir, "c.combined"), "utf-8")).toBe(
      "c: png=PNG-C json=JSON-C pulled=2",
    );
  });

  test("no match option broadcasts the entire pulled source into every host slice", async () => {
    await run({
      entry: resolve(baseDir, "pipeline-broadcast.ts"),
      outputDirectory: outputDir,
      queryBase: baseDir,
      useWorker: false,
    });

    const outputs = (await readdir(outputDir)).sort();
    expect(outputs).toEqual(["a.broadcast", "b.broadcast", "c.broadcast"]);

    expect(await readFile(resolve(outputDir, "a.broadcast"), "utf-8")).toBe(
      "a: png=PNG-A jsons=3",
    );
    expect(await readFile(resolve(outputDir, "b.broadcast"), "utf-8")).toBe(
      "b: png=PNG-B jsons=3",
    );
    expect(await readFile(resolve(outputDir, "c.broadcast"), "utf-8")).toBe(
      "c: png=PNG-C jsons=3",
    );
  });
});
