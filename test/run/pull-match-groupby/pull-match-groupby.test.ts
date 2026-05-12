import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("pull-match groupBy", () => {
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
    await mkdir(resolve(assetsDir, "alpha"), { recursive: true });
    await mkdir(resolve(assetsDir, "beta"), { recursive: true });
    await mkdir(resolve(assetsDir, "gamma"), { recursive: true });
    await writeFile(resolve(assetsDir, "alpha", "1.png"), "ALPHA-1");
    await writeFile(resolve(assetsDir, "alpha", "2.png"), "ALPHA-2");
    await writeFile(resolve(assetsDir, "beta", "1.png"), "BETA-1");
    await writeFile(resolve(assetsDir, "gamma", "1.png"), "GAMMA-1");
    await writeFile(resolve(assetsDir, "alpha.json"), "JSON-ALPHA");
    await writeFile(resolve(assetsDir, "beta.json"), "JSON-BETA");
    await writeFile(resolve(assetsDir, "gamma.json"), "JSON-GAMMA");
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterDir, { recursive: true, force: true });
  });

  test("re-running with no changes serves every group from cache", async () => {
    await runOnce();
    expect(await getCounters()).toEqual({
      "meta-alpha": 1,
      "meta-beta": 1,
      "meta-gamma": 1,
      "host-alpha": 1,
      "host-beta": 1,
      "host-gamma": 1,
    });

    await runOnce();
    expect(await getCounters()).toEqual({
      "meta-alpha": 1,
      "meta-beta": 1,
      "meta-gamma": 1,
      "host-alpha": 1,
      "host-beta": 1,
      "host-gamma": 1,
    });
  });

  test("changing a host file re-runs only that group; metadata stays cached", async () => {
    await runOnce();

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "alpha", "1.png"), "ALPHA-1-CHANGED");
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    expect(await getCounters()).toEqual({
      "meta-alpha": 1,
      "meta-beta": 1,
      "meta-gamma": 1,
      "host-alpha": 2,
      "host-beta": 1,
      "host-gamma": 1,
    });
  });

  test("changing a matched pulled file re-runs only the host group that matches it", async () => {
    await runOnce();

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "alpha.json"), "JSON-ALPHA-CHANGED");
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    expect(await getCounters()).toEqual({
      "meta-alpha": 2,
      "meta-beta": 1,
      "meta-gamma": 1,
      "host-alpha": 2,
      "host-beta": 1,
      "host-gamma": 1,
    });

    expect(await readFile(resolve(outputDir, "alpha.bundle"), "utf-8")).toBe(
      "alpha: pngs=2 jsons=1 json=JSON-ALPHA-CHANGED",
    );
    expect(await readFile(resolve(outputDir, "beta.bundle"), "utf-8")).toBe(
      "beta: pngs=1 jsons=1 json=JSON-BETA",
    );
  });

  test("removing a matched pulled file invalidates only the host group it was matching", async () => {
    await runOnce();

    await new Promise((r) => setTimeout(r, 100));
    await rm(resolve(assetsDir, "alpha.json"));
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    const counts = await getCounters();
    expect(counts["host-alpha"]).toBe(2);
    expect(counts["host-beta"]).toBe(1);
    expect(counts["host-gamma"]).toBe(1);

    expect(await readFile(resolve(outputDir, "alpha.bundle"), "utf-8")).toBe(
      "alpha: pngs=2 jsons=0 json=(none)",
    );
  });

  test("adding a new pulled file that matches an existing group invalidates only that group", async () => {
    await runOnce();

    await new Promise((r) => setTimeout(r, 100));
    // alpha.extra.json — stem (split('.')[0]) is "alpha" → matches alpha group
    await writeFile(resolve(assetsDir, "alpha.extra.json"), "JSON-ALPHA-EXTRA");
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    const counts = await getCounters();
    expect(counts["host-alpha"]).toBe(2);
    expect(counts["host-beta"]).toBe(1);
    expect(counts["host-gamma"]).toBe(1);
  });

  test("adding a host file to an existing group invalidates that group", async () => {
    await runOnce();

    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, "alpha", "3.png"), "ALPHA-3");
    await new Promise((r) => setTimeout(r, 100));

    await runOnce();

    const counts = await getCounters();
    expect(counts["host-alpha"]).toBe(2);
    expect(counts["host-beta"]).toBe(1);
    expect(counts["host-gamma"]).toBe(1);
  });
});
