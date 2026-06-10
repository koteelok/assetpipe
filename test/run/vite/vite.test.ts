import { assetpipe } from "@assetpipe/vite";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { build } from "vite";

describe("vite SPA build", () => {
  const root = __dirname;
  const srcDir = resolve(root, "src");
  const assetsDir = resolve(root, "assets");
  const outputDir = resolve(root, "output");
  const cacheDir = resolve(root, "cache");
  const buildOut = resolve(root, "dist");
  const viteCacheDir = resolve(cacheDir, "vite");
  const entry = resolve(root, "pipeline.ts");

  const cleanup = () =>
    Promise.all([
      rm(assetsDir, { recursive: true, force: true }),
      rm(outputDir, { recursive: true, force: true }),
      rm(cacheDir, { recursive: true, force: true }),
      rm(buildOut, { recursive: true, force: true }),
    ]);

  beforeEach(async () => {
    await cleanup();
    await mkdir(assetsDir, { recursive: true });
    await writeFile(resolve(assetsDir, "hello.txt"), "hello world");
  });

  afterEach(async () => {
    await cleanup();
  });

  test("SPA build emits pipeline assets and the bundle references them", async () => {
    await build({
      root: srcDir,
      cacheDir: viteCacheDir,
      logLevel: "warn",
      configFile: false,
      build: {
        outDir: buildOut,
        emptyOutDir: true,
        write: true,
        rollupOptions: {
          input: resolve(srcDir, "index.html"),
        },
      },
      plugins: [
        assetpipe({
          entry,
          outputDirectory: outputDir,
          cacheDirectory: cacheDir,
        }),
      ],
    });

    const files = (await readdir(buildOut, { recursive: true })).map((f) =>
      String(f).replace(/\\/g, "/"),
    );
    expect(files).toContain("index.html");

    const html = await readFile(resolve(buildOut, "index.html"), "utf-8");
    const scriptMatch = html.match(/src="([^"]+\.js)"/);
    expect(
      scriptMatch,
      "html should reference the entry script",
    ).not.toBeNull();
    const bundlePath = scriptMatch![1].replace(/^\//, "");
    const bundle = await readFile(resolve(buildOut, bundlePath), "utf-8");

    // The pipeline asset should be emitted into the build output and the
    // bundle should reference it — i.e. the ROLLUP_FILE_URL_* placeholder
    // must be substituted with the final asset URL, not left in the bundle
    // as a literal string.
    const emittedAsset = files.find(
      (f) => f.startsWith("assets/") && !f.endsWith(".js"),
    );
    expect(emittedAsset, "pipeline asset should be emitted").toBeDefined();
    expect(await readFile(resolve(buildOut, emittedAsset!), "utf-8")).toBe(
      "hello world",
    );

    expect(
      bundle,
      "bundle should not contain unresolved ROLLUP_FILE_URL_ placeholders",
    ).not.toMatch(/ROLLUP_FILE_URL_/);

    // The bundle should reference the emitted asset's basename.
    const emittedBasename = emittedAsset!.split("/").pop()!;
    expect(bundle).toContain(emittedBasename);
  });

  test("SPA build inlines ?raw imports as strings", async () => {
    await build({
      root: srcDir,
      cacheDir: viteCacheDir,
      logLevel: "warn",
      configFile: false,
      build: {
        outDir: buildOut,
        emptyOutDir: true,
        write: true,
        rollupOptions: {
          input: resolve(srcDir, "raw.html"),
        },
      },
      plugins: [
        assetpipe({
          entry,
          outputDirectory: outputDir,
          cacheDirectory: cacheDir,
        }),
      ],
    });

    const html = await readFile(resolve(buildOut, "raw.html"), "utf-8");
    const scriptMatch = html.match(/src="([^"]+\.js)"/);
    expect(scriptMatch).not.toBeNull();
    const bundlePath = scriptMatch![1].replace(/^\//, "");
    const bundle = await readFile(resolve(buildOut, bundlePath), "utf-8");
    expect(bundle).toContain("hello world");

    // ?raw should not emit a separate asset file
    const allFiles = await readdir(buildOut, { recursive: true });
    const txtAssets = allFiles.filter(
      (f) => typeof f === "string" && f.endsWith(".txt"),
    );
    expect(txtAssets).toHaveLength(0);
  });

  test("emit: true copies unimported outputs into the bundle at literal paths", async () => {
    // plain.txt is never imported — without `emit` it would not reach dist.
    await writeFile(resolve(assetsDir, "plain.txt"), "runtime-addressed");

    await build({
      root: srcDir,
      cacheDir: viteCacheDir,
      logLevel: "warn",
      configFile: false,
      build: {
        outDir: buildOut,
        emptyOutDir: true,
        write: true,
        rollupOptions: {
          input: resolve(srcDir, "index.html"),
        },
      },
      plugins: [
        assetpipe({
          entry,
          outputDirectory: outputDir,
          cacheDirectory: cacheDir,
          emit: true,
        }),
      ],
    });

    // The unimported output lands at its literal target path.
    expect(await readFile(resolve(buildOut, "plain.txt"), "utf-8")).toBe(
      "runtime-addressed",
    );

    // The imported output (hello.txt) is emitted as a hashed asset through
    // its module — emit: true must not ship a second, literal-path copy.
    const files = (await readdir(buildOut, { recursive: true })).map((f) =>
      String(f).replace(/\\/g, "/"),
    );
    expect(files).not.toContain("hello.txt");
    expect(
      files.some((f) => f.startsWith("assets/") && f.endsWith(".txt")),
      "imported hello.txt should still exist as a hashed asset",
    ).toBe(true);
  });

  test("emit predicate gives full per-file control", async () => {
    await writeFile(resolve(assetsDir, "plain.txt"), "runtime-addressed");
    await writeFile(resolve(assetsDir, "skipped.txt"), "left out");

    await build({
      root: srcDir,
      cacheDir: viteCacheDir,
      logLevel: "warn",
      configFile: false,
      build: {
        outDir: buildOut,
        emptyOutDir: true,
        write: true,
        rollupOptions: {
          input: resolve(srcDir, "index.html"),
        },
      },
      plugins: [
        assetpipe({
          entry,
          outputDirectory: outputDir,
          cacheDirectory: cacheDir,
          emit: (file) => file.basename === "plain.txt",
        }),
      ],
    });

    const files = (await readdir(buildOut, { recursive: true })).map((f) =>
      String(f).replace(/\\/g, "/"),
    );
    expect(files).toContain("plain.txt");
    expect(files).not.toContain("skipped.txt");
  });
});
