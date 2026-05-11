import { assetpipe } from "@assetpipe/vite";
import type { ExecutionMetadata } from "@assetpipe/core/runtime";
import type { File as PipelineFile } from "@assetpipe/core/types";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { build, createServer, type ViteDevServer } from "vite";
import { waitForCalls } from "../../utils";

describe("vite integration", () => {
  const root = __dirname;
  const fixtureDir = resolve(root, "fixture");
  const assetsDir = resolve(root, "assets");
  const outputDir = resolve(root, "output");
  const cacheDir = resolve(root, "cache");
  const buildOut = resolve(root, "dist");
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
      root: fixtureDir,
      logLevel: "warn",
      configFile: false,
      build: {
        outDir: buildOut,
        emptyOutDir: true,
        write: true,
        rollupOptions: {
          input: resolve(fixtureDir, "index.html"),
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
      root: fixtureDir,
      logLevel: "warn",
      configFile: false,
      build: {
        outDir: buildOut,
        emptyOutDir: true,
        write: true,
        rollupOptions: {
          input: resolve(fixtureDir, "raw.html"),
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

  test("dev server resolves imports to dev URLs and serves outputs over HTTP", async () => {
    const server = await createServer({
      root: fixtureDir,
      logLevel: "warn",
      configFile: false,
      server: { port: 0, host: "127.0.0.1" },
      plugins: [
        assetpipe({
          entry,
          outputDirectory: outputDir,
          cacheDirectory: cacheDir,
        }),
      ],
    });

    try {
      await server.listen();

      const result = await server.transformRequest(
        resolve(fixtureDir, "main.js"),
      );
      expect(result, "main.js should be transformable").not.toBeNull();
      // The plugin's load() in dev mode returns `export default "<url>?t=<ts>"`
      // — the import in main.js gets rewritten by Vite to point at the
      // virtual module, but the resolved virtual module's loaded code
      // should embed the dev URL with a cache-busting timestamp.
      const virtual = await server.transformRequest("\0assetpipe:/hello.txt");
      expect(virtual).not.toBeNull();
      expect(virtual!.code).toMatch(/hello\.txt\?t=\d+/);

      const port = serverPort(server);
      const res = await fetch(`http://127.0.0.1:${port}/hello.txt`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello world");
    } finally {
      await server.close();
    }
  });

  test("dev server invokes handleReload when an input asset changes", async () => {
    const handleReload =
      vi.fn<
        (opts: {
          server: ViteDevServer;
          files: PipelineFile[];
          metadata: ExecutionMetadata;
        }) => void
      >();

    const server = await createServer({
      root: fixtureDir,
      logLevel: "warn",
      configFile: false,
      server: { port: 0, host: "127.0.0.1" },
      plugins: [
        assetpipe({
          entry,
          outputDirectory: outputDir,
          cacheDirectory: cacheDir,
          handleReload,
        }),
      ],
    });

    try {
      await server.listen();

      // Force the plugin to wait for the first pipeline run by resolving
      // an import. The first run does NOT trigger handleReload.
      await server.transformRequest(resolve(fixtureDir, "main.js"));
      expect(handleReload).not.toHaveBeenCalled();

      await writeFile(resolve(assetsDir, "hello.txt"), "hello again");

      const [args] = await waitForCalls(handleReload, 1);
      expect(args.files.length).toBeGreaterThan(0);
      expect(args.metadata.changedFiles.length).toBeGreaterThan(0);

      // Verify the served content reflects the change
      const port = serverPort(server);
      const res = await fetch(`http://127.0.0.1:${port}/hello.txt`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello again");
    } finally {
      await server.close();
    }
  });

  test("custom prefix scopes which imports the plugin claims", async () => {
    const server = await createServer({
      root: fixtureDir,
      logLevel: "warn",
      configFile: false,
      server: { port: 0, host: "127.0.0.1" },
      plugins: [
        assetpipe({
          entry,
          outputDirectory: outputDir,
          cacheDirectory: cacheDir,
          prefix: "/@asset/",
        }),
      ],
    });

    try {
      await server.listen();

      // /@asset/hello.txt should resolve via the plugin
      const prefixed = await server.transformRequest(
        resolve(fixtureDir, "prefixed.js"),
      );
      expect(prefixed).not.toBeNull();

      const virtual = await server.transformRequest("\0assetpipe:/hello.txt");
      expect(virtual).not.toBeNull();
      expect(virtual!.code).toMatch(/hello\.txt\?t=\d+/);

      // Bare /hello.txt (without the configured prefix) should NOT be
      // claimed by the plugin — Vite will fail to resolve it, so the
      // transform of main.js should reject.
      await expect(
        server.transformRequest(resolve(fixtureDir, "main.js")),
      ).rejects.toThrow();
    } finally {
      await server.close();
    }
  });
});

function serverPort(server: ViteDevServer): number {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("dev server has no bound port");
  }
  return address.port;
}
