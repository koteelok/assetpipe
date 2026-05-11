import { File } from "@assetpipe/config";
import { ExecutionMetadata, run } from "@assetpipe/core/runtime";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("transitive-pull-caching", () => {
  const assetsDir = resolve(__dirname, "assets");
  const cacheDir = resolve(__dirname, "cache");
  const outputDir = resolve(__dirname, "output");
  const entry = resolve(__dirname, "pipeline.ts");
  const counterFile = resolve(__dirname, "counters.json");
  const metadataFile = resolve(assetsDir, "metadata", "m.txt");

  beforeEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterFile, { force: true });
    await mkdir(resolve(assetsDir, "metadata"), { recursive: true });
    await mkdir(resolve(assetsDir, "textures"), { recursive: true });
    await writeFile(metadataFile, "v1");
    await writeFile(resolve(assetsDir, "textures", "t.txt"), "T");
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterFile, { force: true });
  });

  async function getCounters(): Promise<Record<string, number>> {
    try {
      return JSON.parse(await readFile(counterFile, "utf-8"));
    } catch {
      return {};
    }
  }

  // Regression: when an InteractivePipeline pulls a sub-pipeline whose own
  // pulls are dirty (e.g. group().pull(query).pipe()), the parent must
  // re-execute from that pull — not skip via its full pipelineKey cache.
  // Additionally, full cache-hit runs must not shrink the saved cache: the
  // sub-pipeline's beforePullKey/pipelineKey entries have to survive into
  // the next saveResults so subsequent partial recomputes can use them.
  test("dirty transitive pull invalidates parent only after the pull", async () => {
    const onOutput =
      vi.fn<(files: File[], metadata?: ExecutionMetadata) => void>();
    const runOnce = () =>
      run({
        entry,
        outputDirectory: outputDir,
        cacheDirectory: cacheDir,
        queryBase: __dirname,
        onOutput,
        useWorker: false,
      });

    // Phase 1 — cold run, every stage executes once.
    await runOnce();
    expect(await getCounters()).toEqual({
      generate: 1,
      registry: 1,
      reencode: 1,
      root: 1,
    });

    // Phase 2 — no changes, full cache hit, nothing re-runs.
    await runOnce();
    expect(await getCounters()).toEqual({
      generate: 1,
      registry: 1,
      reencode: 1,
      root: 1,
    });

    // Phase 3 — change a file the registry depends on. The atlas does not
    // read it, so `generate` must NOT re-run; `registry` and `reencode`
    // must re-run; `root` must re-run (its input changed).
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(metadataFile, "v2");
    await new Promise((r) => setTimeout(r, 100));
    await runOnce();
    expect(await getCounters()).toEqual({
      generate: 1,
      registry: 2,
      reencode: 2,
      root: 2,
    });

    // Phase 4 — revert the file. This previously masked the bug: after
    // phase 2 saved a shrunken cache, the atlas's pipelineKey was missing
    // and `firstDirtyPull` was not set, so phase 4 either recomputed
    // everything or skipped everything. With the fix it behaves like
    // phase 3.
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(metadataFile, "v1");
    await new Promise((r) => setTimeout(r, 100));
    await runOnce();
    expect(await getCounters()).toEqual({
      generate: 1,
      registry: 3,
      reencode: 3,
      root: 3,
    });

    // The output reflects the latest registry — the texture flowed through
    // the cached `generate` step, then the freshly recomputed registry was
    // appended by `reencode`, then wrapped by `root`.
    const out = await readFile(resolve(outputDir, "out.txt"), "utf-8");
    expect(out).toBe("T|atlasv1|registry|reencoded|root");
  });
});
