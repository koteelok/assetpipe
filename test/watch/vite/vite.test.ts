import { assetpipe } from "@assetpipe/vite";
import type { ExecutionMetadata } from "@assetpipe/core/runtime";
import type { File as PipelineFile } from "@assetpipe/core/types";
import { mkdir, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { waitForCalls } from "../../utils";

describe("vite dev server", () => {
  const root = __dirname;
  const srcDir = resolve(root, "src");
  const assetsDir = resolve(root, "assets");
  const outputDir = resolve(root, "output");
  const cacheDir = resolve(root, "cache");
  const viteCacheDir = resolve(cacheDir, "vite");
  const entry = resolve(root, "pipeline.ts");

  const cleanup = () =>
    Promise.all([
      rm(assetsDir, { recursive: true, force: true }),
      rm(outputDir, { recursive: true, force: true }),
      rm(cacheDir, { recursive: true, force: true }),
    ]);

  beforeEach(async () => {
    await cleanup();
    await mkdir(assetsDir, { recursive: true });
    await writeFile(resolve(assetsDir, "hello.txt"), "hello world");
  });

  afterEach(async () => {
    await cleanup();
  });

  test("resolves imports to dev URLs and serves outputs over HTTP", async () => {
    const server = await createServer({
      root: srcDir,
      cacheDir: viteCacheDir,
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

      const result = await server.transformRequest(resolve(srcDir, "main.js"));
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

  test("invokes handleReload when an input asset changes", async () => {
    const handleReload =
      vi.fn<
        (opts: {
          server: ViteDevServer;
          files: readonly PipelineFile[];
          metadata: ExecutionMetadata;
        }) => void
      >();

    const server = await createServer({
      root: srcDir,
      cacheDir: viteCacheDir,
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
      await server.transformRequest(resolve(srcDir, "main.js"));
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
      root: srcDir,
      cacheDir: viteCacheDir,
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
        resolve(srcDir, "prefixed.js"),
      );
      expect(prefixed).not.toBeNull();

      const virtual = await server.transformRequest("\0assetpipe:/hello.txt");
      expect(virtual).not.toBeNull();
      expect(virtual!.code).toMatch(/hello\.txt\?t=\d+/);

      // Bare /hello.txt (without the configured prefix) should NOT be
      // claimed by the plugin — Vite will fail to resolve it, so the
      // transform of main.js should reject.
      await expect(
        server.transformRequest(resolve(srcDir, "main.js")),
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
