import { watch } from "@assetpipe/core/runtime";
import { File } from "@assetpipe/core/types";
import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { waitForCalls } from "../utils";

describe("watcher mode", () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const assetsDirectory = resolve(__dirname, "assets");

  beforeEach(async () => {
    await rm(assetsDirectory, { recursive: true, force: true });
    await mkdir(assetsDirectory, { recursive: true });
    for (let i = 1; i < 5; i++) {
      await writeFile(join(assetsDirectory, `${i}.txt`), `${i}`);
    }
  });

  afterAll(async () => {
    await rm(assetsDirectory, { recursive: true, force: true });
  });

  test("initial spawn produces output", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: __dirname,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();

    const [files] = await waitForCalls(onOutput, 1);
    const content = await readFile(files[0].content, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toConsistOf("1 | 2 | 3 | 4");

    await watcher.despawn();
  });

  test("file change triggers output", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: __dirname,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    await waitForCalls(onOutput, 1);

    await writeFile(resolve(assetsDirectory, "2.txt"), "22");

    let [files] = await waitForCalls(onOutput, 2);

    const content = await readFile(files[0].content, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toConsistOf("1 | 22 | 3 | 4");

    await writeFile(resolve(assetsDirectory, "2.txt"), "2");

    [files] = await waitForCalls(onOutput, 3);
    const updatedContent = await readFile(files[0].content, "utf-8");
    expect(updatedContent.length).toBeGreaterThan(0);
    expect(updatedContent).toConsistOf("1 | 2 | 3 | 4");

    await watcher.despawn();
  });

  test("file creation/deletion triggers output", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: __dirname,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    await waitForCalls(onOutput, 1);

    await writeFile(resolve(assetsDirectory, "5.txt"), "5");

    let [files] = await waitForCalls(onOutput, 2);
    let content = await readFile(files[0].content, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toConsistOf("1 | 2 | 3 | 4 | 5");

    await unlink(resolve(assetsDirectory, "5.txt"));

    [files] = await waitForCalls(onOutput, 3);
    content = await readFile(files[0].content, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toConsistOf("1 | 2 | 3 | 4");

    await watcher.despawn();
  });
});
