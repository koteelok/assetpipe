import { watch } from "@assetpipe/core/runtime";
import { File } from "@assetpipe/core/types";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { waitForCalls } from "../../utils";

const WATCH_TIMEOUT = 30_000;

describe("pull-match watch", () => {
  const baseDir = __dirname;
  const assetsDir = resolve(baseDir, "assets");
  const cacheDir = resolve(baseDir, "cache");
  const entry = resolve(baseDir, "pipeline.ts");

  beforeEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(assetsDir, { recursive: true });
    await writeFile(resolve(assetsDir, "a.png"), "PNG-A");
    await writeFile(resolve(assetsDir, "b.png"), "PNG-B");
    await writeFile(resolve(assetsDir, "a.json"), "JSON-A");
    await writeFile(resolve(assetsDir, "b.json"), "JSON-B");
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  });

  function combinedOf(files: File[], stem: string) {
    return files.find((f) => f.basename === `${stem}.combined`);
  }

  test("initial spawn emits a combined output per host slice with its match", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: baseDir,
      cacheDirectory: cacheDir,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    const [files] = await waitForCalls(onOutput, 1);

    expect(files.map((f) => f.basename).sort()).toEqual([
      "a.combined",
      "b.combined",
    ]);
    expect(await readFile(combinedOf(files, "a")!.content, "utf-8")).toBe(
      "a: png=PNG-A json=JSON-A",
    );
    expect(await readFile(combinedOf(files, "b")!.content, "utf-8")).toBe(
      "b: png=PNG-B json=JSON-B",
    );

    await watcher.despawn();
  }, WATCH_TIMEOUT);

  test("changing a host file in watch mode re-emits with the matched pull", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: baseDir,
      cacheDirectory: cacheDir,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    await waitForCalls(onOutput, 1);

    await writeFile(resolve(assetsDir, "a.png"), "PNG-A-CHANGED");

    const [files] = await waitForCalls(onOutput, 2);

    expect(files.map((f) => f.basename).sort()).toEqual([
      "a.combined",
      "b.combined",
    ]);
    expect(await readFile(combinedOf(files, "a")!.content, "utf-8")).toBe(
      "a: png=PNG-A-CHANGED json=JSON-A",
    );
    expect(await readFile(combinedOf(files, "b")!.content, "utf-8")).toBe(
      "b: png=PNG-B json=JSON-B",
    );

    await watcher.despawn();
  }, WATCH_TIMEOUT);

  test("adding a new host/meta pair in watch mode emits a new combined output", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: baseDir,
      cacheDirectory: cacheDir,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    await waitForCalls(onOutput, 1);

    await writeFile(resolve(assetsDir, "c.json"), "JSON-C");
    await writeFile(resolve(assetsDir, "c.png"), "PNG-C");

    // The two writes can trigger separate emits; wait until the c.png write
    // produces a fully-formed combined output.
    let files: File[] = [];
    for (let attempt = 2; attempt <= 6; attempt++) {
      [files] = await waitForCalls(onOutput, attempt);
      const c = combinedOf(files, "c");
      if (c) {
        const content = await readFile(c.content, "utf-8");
        if (content === "c: png=PNG-C json=JSON-C") break;
      }
    }

    expect(files.map((f) => f.basename).sort()).toEqual([
      "a.combined",
      "b.combined",
      "c.combined",
    ]);
    expect(await readFile(combinedOf(files, "c")!.content, "utf-8")).toBe(
      "c: png=PNG-C json=JSON-C",
    );

    await watcher.despawn();
  }, WATCH_TIMEOUT);
});
