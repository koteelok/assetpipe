import { watch } from "@assetpipe/core/runtime";
import { File } from "@assetpipe/core/types";
import { mkdir, readFile, rm, unlink, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterAll, beforeAll, describe, expect, Mock, test, vi } from "vitest";

function waitForCalls(spy: Mock, callCount: number, timeout = 10_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out waiting for console.log call #${callCount}. Got ${spy.mock.calls.length} call(s).`,
          ),
        ),
      timeout,
    );

    const check = () => {
      if (spy.mock.calls.length >= callCount) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };

    check();
  });
}

describe("watcher mode", () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const cacheDirectory = resolve(__dirname, "cache");
  const assetsDirectory = resolve(__dirname, "assets");

  beforeAll(async () => {
    await mkdir(assetsDirectory, { recursive: true });

    await Promise.all(
      [1, 2, 3, 4].map((i) =>
        writeFile(resolve(assetsDirectory, `${i}.txt`), `${i}`),
      ),
    );
  });

  afterAll(async () => {
    await rm(assetsDirectory, { recursive: true });
  });

  test("initial spawn produces output", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      cacheDirectory,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    await waitForCalls(onOutput, 1);

    const [files] = onOutput.mock.calls[0];

    const content = await readFile(files[0].content, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toConsistOf("1 | 2 | 3 | 4");

    await watcher.despawn();
  });

  test("file change triggers output", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      cacheDirectory,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    await waitForCalls(onOutput, 1);

    await writeFile(resolve(assetsDirectory, "2.txt"), "22");
    await waitForCalls(onOutput, 2);

    let files = onOutput.mock.calls[1][0];

    const content = await readFile(files[0].content, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toConsistOf("1 | 22 | 3 | 4");

    await writeFile(resolve(assetsDirectory, "2.txt"), "2");
    await waitForCalls(onOutput, 3);

    files = onOutput.mock.calls[2][0];
    const updatedContent = await readFile(files[0].content, "utf-8");
    expect(updatedContent.length).toBeGreaterThan(0);
    expect(updatedContent).toConsistOf("1 | 2 | 3 | 4");

    await watcher.despawn();
  });

  test("file creation/deletion triggers output", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      cacheDirectory,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    await waitForCalls(onOutput, 1);

    await writeFile(resolve(assetsDirectory, "5.txt"), "5");
    await waitForCalls(onOutput, 2);

    let files = onOutput.mock.calls[1][0];
    let content = await readFile(files[0].content, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toConsistOf("1 | 2 | 3 | 4 | 5");

    await unlink(resolve(assetsDirectory, "5.txt"));
    await waitForCalls(onOutput, 3);

    files = onOutput.mock.calls[2][0];
    content = await readFile(files[0].content, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toConsistOf("1 | 2 | 3 | 4");

    await watcher.despawn();
  });
});
