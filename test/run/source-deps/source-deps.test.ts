import { run } from "@assetpipe/core/runtime";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("cache invalidation on source-code dependency changes", () => {
  const root = resolve(__dirname, "fixture");
  const srcDir = resolve(root, "src");
  const assetsDir = resolve(root, "assets");
  const cacheDir = resolve(root, "cache");
  const outputDir = resolve(root, "output");
  const entry = resolve(srcDir, "pipeline.ts");
  const formatter = resolve(root, "formatter.ts");
  const outFile = resolve(outputDir, "out.txt");

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

    await writeFile(
      entry,
      `
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
  return [{ basename: "out.txt", dirname: "", content: out }];
});
`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("changing a transitively-imported source file invalidates the cache", async () => {
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: root,
      useWorker: false,
    });

    expect(await readFile(outFile, "utf-8")).toBe("A|B");

    await writeFile(
      formatter,
      `export function format(parts: string[]) { return parts.join(":"); }\n`,
    );

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: root,
      useWorker: false,
    });

    expect(await readFile(outFile, "utf-8")).toBe("A:B");
  }, 30_000);
});

describe("cache invalidation with a deep import graph", () => {
  const root = resolve(__dirname, "deep-fixture");
  const assetsDir = resolve(root, "assets");
  const cacheDir = resolve(root, "cache");
  const outputDir = resolve(root, "output");
  const entry = resolve(root, "vite/assetpipe/main.ts");
  const subpipeline = resolve(
    root,
    "vite/assetpipe/subpipelines/tilemap/pipeline.ts",
  );
  const utilsHelper = resolve(root, "src/core/utils/format.ts");
  const outFile = resolve(outputDir, "out.txt");

  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(assetsDir, { recursive: true });
    await mkdir(resolve(root, "vite/assetpipe/subpipelines/tilemap"), {
      recursive: true,
    });
    await mkdir(resolve(root, "src/core/utils"), { recursive: true });

    await writeFile(resolve(assetsDir, "x.txt"), "x");
    await writeFile(resolve(assetsDir, "y.txt"), "y");

    // A sibling-tree dep (mirrors the user repo's `src/core/...` imports).
    await writeFile(
      utilsHelper,
      `export const upper = (s: string) => s.toUpperCase();\n`,
    );

    // A deep subpipeline file (mirrors `subpipelines/tilemap/pipeline.ts`).
    await writeFile(
      subpipeline,
      `import { upper } from "../../../../src/core/utils/format";
export function transform(parts: string[]) { return parts.map(upper).join(","); }
`,
    );

    await writeFile(
      entry,
      `
import { query, tmpfile } from "@assetpipe/config";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { transform } from "./subpipelines/tilemap/pipeline";

const ASSETS = path.join(__dirname, "../../assets/*.txt").replace(/\\\\/g, "/");

export default query(ASSETS).pipe(async (files) => {
  const out = tmpfile();
  const parts = await Promise.all(
    files.map((f) => readFile(f.content, "utf-8")),
  );
  await writeFile(out, transform(parts));
  return [{ basename: "out.txt", dirname: "", content: out }];
});
`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("changing the deep subpipeline file invalidates the cache", async () => {
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: root,
      useWorker: false,
    });

    expect(await readFile(outFile, "utf-8")).toBe("X,Y");

    await writeFile(
      subpipeline,
      `import { upper } from "../../../../src/core/utils/format";
export function transform(parts: string[]) { return parts.map(upper).join("|"); }
`,
    );

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: root,
      useWorker: false,
    });

    expect(await readFile(outFile, "utf-8")).toBe("X|Y");
  }, 30_000);

  test("changing a sibling-tree helper file invalidates the cache", async () => {
    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: root,
      useWorker: false,
    });

    expect(await readFile(outFile, "utf-8")).toBe("X,Y");

    await writeFile(
      utilsHelper,
      `export const upper = (s: string) => "[" + s.toUpperCase() + "]";\n`,
    );

    await run({
      entry,
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: root,
      useWorker: false,
    });

    expect(await readFile(outFile, "utf-8")).toBe("[X],[Y]");
  }, 30_000);
});
