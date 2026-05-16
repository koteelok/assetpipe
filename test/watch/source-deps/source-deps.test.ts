import { watch } from "@assetpipe/core/runtime";
import type { File } from "@assetpipe/core/types";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { waitForCalls } from "../../utils";

describe("source-code dependency watching", () => {
  const root = resolve(__dirname, "fixture");
  const srcDir = resolve(root, "src");
  const assetsDir = resolve(root, "assets");
  const entry = resolve(srcDir, "pipeline.ts");
  const formatter = resolve(root, "formatter.ts");

  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(srcDir, { recursive: true });
    await mkdir(assetsDir, { recursive: true });

    await writeFile(resolve(assetsDir, "a.txt"), "A");
    await writeFile(resolve(assetsDir, "b.txt"), "B");

    await writeFile(
      formatter,
      `export function format(parts: string[]) { return parts.join("|"); }\n`,
    );

    const entrySource = `
import { query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { format } from "../formatter";

const ASSETS = path.join(__dirname, "..", "assets/*.txt").replace(/\\\\/g, "/");

export default query(ASSETS).pipe(async (files) => {
  const out = tmpfile();
  const parts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  await writeFile(out, format(parts));
  return [{ target: "out.txt", content: out }];
});
`;
    await writeFile(entry, entrySource);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("modifying a transitively-imported source file re-runs the pipeline", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: root,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    try {
      const [first] = await waitForCalls(onOutput, 1);
      expect(await readFile(first[0].content, "utf-8")).toBe("A|B");

      await writeFile(
        formatter,
        `export function format(parts: string[]) { return parts.join(":"); }\n`,
      );

      const [second] = await waitForCalls(onOutput, 2);
      expect(await readFile(second[0].content, "utf-8")).toBe("A:B");
    } finally {
      await watcher.despawn();
    }
  });

  test("modifying the entry file re-runs the pipeline", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: root,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    try {
      await waitForCalls(onOutput, 1);

      const original = await readFile(entry, "utf-8");
      await writeFile(entry, `${original}\n// touched\n`);

      await waitForCalls(onOutput, 2);
    } finally {
      await watcher.despawn();
    }
  });
});

describe("source-code dependency watching (deep chain)", () => {
  const root = resolve(__dirname, "deep-fixture");
  const assetsDir = resolve(root, "assets");
  const entry = resolve(root, "pipeline.ts");
  const layerA = resolve(root, "layers/a/index.ts");
  const layerB = resolve(root, "layers/a/b/index.ts");
  const layerC = resolve(root, "layers/a/b/c/transform.ts");

  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(assetsDir, { recursive: true });
    await mkdir(resolve(root, "layers/a/b/c"), { recursive: true });

    await writeFile(resolve(assetsDir, "x.txt"), "X");
    await writeFile(resolve(assetsDir, "y.txt"), "Y");

    // Deepest layer: applies a per-part transform.
    await writeFile(
      layerC,
      `export const transform = (s: string) => s.toLowerCase();\n`,
    );

    // Mid layer: re-exports the transform via an `export ... from` (this
    // requires the parser to follow re-export sources).
    await writeFile(layerB, `export { transform } from "./c/transform";\n`);

    // Top layer: depends on mid via a dynamic import to exercise that path.
    await writeFile(
      layerA,
      `export async function run(parts: string[]) {
  const { transform } = await import("./b");
  return parts.map(transform).join(",");
}\n`,
    );

    const entrySource = `
import { query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { run } from "./layers/a";

const ASSETS = path.join(__dirname, "assets/*.txt").replace(/\\\\/g, "/");

export default query(ASSETS).pipe(async (files) => {
  const out = tmpfile();
  const parts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  await writeFile(out, await run(parts));
  return [{ target: "out.txt", content: out }];
});
`;
    await writeFile(entry, entrySource);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("modifying the deepest dep (3 levels down) re-runs the pipeline", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: root,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    try {
      const [first] = await waitForCalls(onOutput, 1);
      expect(await readFile(first[0].content, "utf-8")).toBe("x,y");

      await writeFile(
        layerC,
        `export const transform = (s: string) => s.toUpperCase() + "!";\n`,
      );

      const [second] = await waitForCalls(onOutput, 2);
      expect(await readFile(second[0].content, "utf-8")).toBe("X!,Y!");
    } finally {
      await watcher.despawn();
    }
  });

  test("modifying a mid-chain re-export re-runs the pipeline", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: root,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    try {
      await waitForCalls(onOutput, 1);

      // Replace the re-export with an inline implementation. The mid-layer
      // is what changed, but the watcher should still pick it up.
      await writeFile(
        layerB,
        `export const transform = (s: string) => "[" + s + "]";\n`,
      );

      const [second] = await waitForCalls(onOutput, 2);
      expect(await readFile(second[0].content, "utf-8")).toBe("[X],[Y]");
    } finally {
      await watcher.despawn();
    }
  });

  test("modifying the top dep (used via dynamic import) re-runs the pipeline", async () => {
    const onOutput = vi.fn<(files: File[]) => void>();

    const watcher = await watch({
      entry,
      queryBase: root,
      useWorker: false,
      onOutput,
    });

    await watcher.spawn();
    try {
      await waitForCalls(onOutput, 1);

      await writeFile(
        layerA,
        `export async function run(parts: string[]) {
  return parts.join("|");
}\n`,
      );

      const [second] = await waitForCalls(onOutput, 2);
      expect(await readFile(second[0].content, "utf-8")).toBe("X|Y");
    } finally {
      await watcher.despawn();
    }
  });
});
