import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("pull-match caching", () => {
  const baseDir = __dirname;
  const assetsDir = resolve(baseDir, "assets");
  const cacheDir = resolve(baseDir, "cache");
  const outputDir = resolve(baseDir, "output");
  const counterDir = resolve(baseDir, "counters");
  const entry = resolve(baseDir, "pipeline.ts");

  const runOnce = () =>
    run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: baseDir,
      useWorker: true,
    });

  // Poll until the counter directory looks stable: same listing twice in a
  // row with at least one entry. Works around Windows fs visibility lag
  // between the pipeline's writes and the test's readdir.
  async function getCounters() {
    let lastSerialized = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const files = (await readdir(counterDir)).sort();
        const serialized = files.join(",");
        if (files.length > 0 && serialized === lastSerialized) {
          const result: Record<string, number> = {};
          for (const f of files) {
            const count = JSON.parse(
              await readFile(resolve(counterDir, f), "utf-8"),
            );
            result[f.replace(".json", "")] = count;
          }
          return result;
        }
        lastSerialized = serialized;
      } catch {
        // counterDir may not exist yet; ignore
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return {};
  }

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

  test("re-running with no changes serves every slice from cache", async () => {
    await runOnce();
    expect(await getCounters()).toEqual({
      "meta-a": 1,
      "meta-b": 1,
      "meta-c": 1,
      "host-a": 1,
      "host-b": 1,
      "host-c": 1,
    });

    await runOnce();
    expect(await getCounters()).toEqual({
      "meta-a": 1,
      "meta-b": 1,
      "meta-c": 1,
      "host-a": 1,
      "host-b": 1,
      "host-c": 1,
    });

    // Outputs must remain intact across the no-op rerun.
    const outputs = (await readdir(outputDir)).sort();
    expect(outputs).toEqual(["a.combined", "b.combined", "c.combined"]);
  });

  test("changing a host file re-runs only that host slice; metadata stays cached", async () => {
    await runOnce();
    expect(await getCounters()).toEqual({
      "meta-a": 1,
      "meta-b": 1,
      "meta-c": 1,
      "host-a": 1,
      "host-b": 1,
      "host-c": 1,
    });

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "a.png"), "PNG-A-CHANGED");
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    expect(await getCounters()).toEqual({
      "meta-a": 1,
      "meta-b": 1,
      "meta-c": 1,
      "host-a": 2,
      "host-b": 1,
      "host-c": 1,
    });

    expect(await readFile(resolve(outputDir, "a.combined"), "utf-8")).toBe(
      "a: png=PNG-A-CHANGED json=JSON-A pulled=2",
    );
    expect(await readFile(resolve(outputDir, "b.combined"), "utf-8")).toBe(
      "b: png=PNG-B json=JSON-B pulled=2",
    );
    expect(await readFile(resolve(outputDir, "c.combined"), "utf-8")).toBe(
      "c: png=PNG-C json=JSON-C pulled=2",
    );
  });

  test("adding a new host file produces a new slice that pulls its matching metadata", async () => {
    await runOnce();

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "d.png"), "PNG-D");
    await writeFile(resolve(assetsDir, "d.json"), "JSON-D");
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    expect(await readFile(resolve(outputDir, "d.combined"), "utf-8")).toBe(
      "d: png=PNG-D json=JSON-D pulled=2",
    );
    // Pre-existing host slices stay cached: their pipes don't re-run.
    const counts = await getCounters();
    expect(counts["host-a"]).toBe(1);
    expect(counts["host-b"]).toBe(1);
    expect(counts["host-c"]).toBe(1);
    expect(counts["host-d"]).toBe(1);
  });

  test("changing a matched pulled file re-runs only the host slice that matches it", async () => {
    await runOnce();
    expect(await getCounters()).toEqual({
      "meta-a": 1,
      "meta-b": 1,
      "meta-c": 1,
      "host-a": 1,
      "host-b": 1,
      "host-c": 1,
    });

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "a.json"), "JSON-A-CHANGED");
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    // metadata slice for a re-runs; b and c metadata stays cached.
    // host slice a re-runs (its matched pull is dirty); b and c host slices
    // stay cached because their match key didn't change and their
    // contributing source slices are clean.
    expect(await getCounters()).toEqual({
      "meta-a": 2,
      "meta-b": 1,
      "meta-c": 1,
      "host-a": 2,
      "host-b": 1,
      "host-c": 1,
    });

    expect(await readFile(resolve(outputDir, "a.combined"), "utf-8")).toBe(
      "a: png=PNG-A json=JSON-A-CHANGED pulled=2",
    );
    expect(await readFile(resolve(outputDir, "b.combined"), "utf-8")).toBe(
      "b: png=PNG-B json=JSON-B pulled=2",
    );
    expect(await readFile(resolve(outputDir, "c.combined"), "utf-8")).toBe(
      "c: png=PNG-C json=JSON-C pulled=2",
    );
  });

  test("removing a matched pulled file invalidates only the host slice it was matching", async () => {
    await runOnce();

    await new Promise((r) => setTimeout(r, 100));
    await rm(resolve(assetsDir, "a.json"));
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    const counts = await getCounters();
    // a host slice re-runs: its membership changed (one fewer matching source).
    expect(counts["host-a"]).toBe(2);
    // b and c host slices stay cached.
    expect(counts["host-b"]).toBe(1);
    expect(counts["host-c"]).toBe(1);

    expect(await readFile(resolve(outputDir, "a.combined"), "utf-8")).toBe(
      "a: png=PNG-A json=(none) pulled=1",
    );
    expect(await readFile(resolve(outputDir, "b.combined"), "utf-8")).toBe(
      "b: png=PNG-B json=JSON-B pulled=2",
    );
  });

  test("adding a new pulled file that matches an existing host slice invalidates only that slice", async () => {
    await runOnce();

    await new Promise((r) => setTimeout(r, 100));
    // Author another metadata file that match() will accept into the `a` host
    // slice (matches by stem). The match here uses stem of basename; both
    // `a.json` and a hypothetical `a.meta.json` project to "a".
    await writeFile(resolve(assetsDir, "a.meta.json"), "JSON-A-EXTRA");
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    const counts = await getCounters();
    // a host slice re-runs: a new source slice now contributes to it.
    expect(counts["host-a"]).toBe(2);
    expect(counts["host-b"]).toBe(1);
    expect(counts["host-c"]).toBe(1);
  });

  test("changing a matched pulled file does not re-run the host slice's pre-pull pipe", async () => {
    const runWithPrePull = () =>
      run({
        entry: resolve(baseDir, "pipeline-pre-pull.ts"),
        outputDirectory: outputDir,
        cacheDirectory: cacheDir,
        queryBase: baseDir,
        useWorker: true,
      });

    await runWithPrePull();
    expect(await getCounters()).toEqual({
      "meta-a": 1,
      "meta-b": 1,
      "meta-c": 1,
      "pretransform-a": 1,
      "pretransform-b": 1,
      "pretransform-c": 1,
      "host-a": 1,
      "host-b": 1,
      "host-c": 1,
    });

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "a.json"), "JSON-A-CHANGED");
    await new Promise((r) => setTimeout(r, 100));

    await runWithPrePull();

    // meta-a re-runs (its file changed). host-a re-runs (its matched pull is
    // dirty). The pre-pull pipe for slice a should stay cached: a.png is
    // unchanged, so its pre-pull output is identical to last run and could be
    // resumed from. Failing this assertion exposes the gap: sliced pipelines
    // re-execute the whole slice on any dirty input, including pre-pull pipes.
    expect(await getCounters()).toEqual({
      "meta-a": 2,
      "meta-b": 1,
      "meta-c": 1,
      "pretransform-a": 1,
      "pretransform-b": 1,
      "pretransform-c": 1,
      "host-a": 2,
      "host-b": 1,
      "host-c": 1,
    });
  });

  test("changing a matched pulled file does not re-run the clone slice's pre-pull pipe", async () => {
    const runWithClonePrePull = () =>
      run({
        entry: resolve(baseDir, "pipeline-clone-pre-pull.ts"),
        outputDirectory: outputDir,
        cacheDirectory: cacheDir,
        queryBase: baseDir,
        useWorker: true,
      });

    await runWithClonePrePull();
    expect(await getCounters()).toEqual({
      "meta-a": 1,
      "meta-b": 1,
      "meta-c": 1,
      "pretransform-a": 1,
      "pretransform-b": 1,
      "pretransform-c": 1,
      "host-a": 1,
      "host-b": 1,
      "host-c": 1,
    });

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "a.json"), "JSON-A-CHANGED");
    await new Promise((r) => setTimeout(r, 100));

    await runWithClonePrePull();

    // Same invariant as the parallel-host pre-pull test, but the host here is
    // a sliced ClonePipeline (clone of a parallel query). The clone's slice
    // for a.png should resume from its cached pre-pull snapshot when only the
    // matched pull dirties — pretransform-a must stay at 1.
    expect(await getCounters()).toEqual({
      "meta-a": 2,
      "meta-b": 1,
      "meta-c": 1,
      "pretransform-a": 1,
      "pretransform-b": 1,
      "pretransform-c": 1,
      "host-a": 2,
      "host-b": 1,
      "host-c": 1,
    });
  });
});
