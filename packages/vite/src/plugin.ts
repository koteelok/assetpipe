import * as fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { PipelineWatcher, run } from "@assetpipe/core/runtime";
import type { File } from "@assetpipe/core/types";
import sirv from "sirv";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

// --- Utility functions ---

const postfixRE = /[?#].*$/;
function cleanUrl(url: string) {
  return url.replace(postfixRE, "");
}

const windowsSlashRE = /\\/g;
function slash(p: string) {
  return p.replace(windowsSlashRE, "/");
}

function toFilePath(url: string) {
  let filePath = cleanUrl(url);
  if (filePath.indexOf("%") !== -1) {
    try {
      filePath = decodeURI(filePath);
    } catch {
      /* malformed URI */
    }
  }
  return path.posix.normalize(slash(filePath));
}

function encodeURIPath(uri: string) {
  if (uri.startsWith("data:")) return uri;
  const filePath = cleanUrl(uri);
  const postfix = filePath !== uri ? uri.slice(filePath.length) : "";
  return encodeURI(filePath) + postfix;
}

function joinUrlSegments(a: string, b: string) {
  if (!a || !b) return a || b || "";
  if (a.endsWith("/")) a = a.substring(0, a.length - 1);
  if (b[0] !== "/") b = "/" + b;
  return a + b;
}

const rawRE = /(\?|&)raw(?:&|$)/;
function isRawRequest(url: string) {
  return rawRE.test(url);
}

const importRE = /(\?|&)import=?(?:&|$)/;
function isImportRequest(url: string) {
  return importRE.test(url);
}

function isInternalRequest(url: string) {
  return url.startsWith("/@");
}

const urlRE = /(\?|&)url(?:&|$)/;
function isUrlRequest(url: string) {
  return urlRE.test(url);
}

function createPromise<T = void>() {
  const obj = {} as {
    resolved: boolean;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
    promise: Promise<T>;
    restart: () => void;
  };

  obj.restart = () => {
    obj.resolved = false;
    obj.promise = new Promise((res, rej) => {
      obj.resolve = (v) => {
        obj.resolved = true;
        return res(v);
      };
      obj.reject = rej;
    });
  };

  obj.restart();
  return obj;
}

// --- Plugin types ---

export interface AssetPipePluginOptions {
  /**
   * Path to the AssetPipe pipeline entry file.
   *
   * Supports *.js, *.ts, *.mjs, *.cjs, *.mts, *.cts file extensions.
   */
  entry: string;

  cache?: {
    /**
     * Enables caching.
     * @default true
     */
    enabled?: boolean;

    /**
     * Path to the cache directory.
     * @default ".assetpipe"
     */
    directory?: string;
  };

  /**
   * URL prefix for pipeline output files.
   *
   * In dev mode, files are served under this prefix.
   * In build mode, files are emitted as Rollup assets (output location
   * controlled by Vite's `build.assetsDir`).
   *
   * @default ""
   */
  outputDirectory?: string;

  /**
   * Customize dev server behavior after pipeline re-execution.
   *
   * When provided, the plugin will call this function instead of
   * sending a full-reload signal to the client.
   */
  handleReload?: (options: {
    server: ViteDevServer;

    /**
     * The output files from the pipeline execution.
     */
    files: File[];
  }) => void;

  /**
   * Custom function to resolve module imports.
   *
   * Return an ES module string to override how a specific import is loaded.
   * Return `undefined` to fall through to the default behavior.
   */
  resolveImport?: (options: {
    config: ResolvedConfig;
    id: string;
  }) => string | undefined;
}

// --- Plugin ---

export function assetpipe(_pluginOptions: AssetPipePluginOptions): Plugin {
  const options = {
    entry: _pluginOptions.entry,
    outputDirectory: slash(_pluginOptions.outputDirectory || ""),
    cacheEnabled: _pluginOptions.cache?.enabled !== false,
    cacheDirectory:
      _pluginOptions.cache?.enabled !== false
        ? (_pluginOptions.cache?.directory ?? ".assetpipe")
        : undefined,
    handleReload: _pluginOptions.handleReload,
    resolveImport: _pluginOptions.resolveImport,
  };

  let lastBuildTimestamp = -1;
  const activePipeline = createPromise();
  const lastPipelineURLs = new Set<string>();

  /** Maps clean URL -> absolute file path in temp output */
  const pipelineFileMap = new Map<string, string>();

  const tempOutput = path.join(tmpdir(), `assetpipe-${randomUUID()}`);

  function fileUrl(basename: string) {
    return options.outputDirectory
      ? path.posix.join("/", options.outputDirectory, slash(basename))
      : path.posix.join("/", slash(basename));
  }

  function registerOutputFiles(files: File[]) {
    lastPipelineURLs.clear();
    pipelineFileMap.clear();

    for (const file of files) {
      const url = fileUrl(file.basename);
      const absPath = path.join(tempOutput, file.basename);
      lastPipelineURLs.add(url);
      pipelineFileMap.set(url, absPath);
    }

    lastBuildTimestamp = Date.now();
  }

  return {
    name: "assetpipe",

    enforce: "pre",

    async configResolved(config) {
      if (config.command === "build") {
        await fsp.mkdir(tempOutput, { recursive: true });

        let outputFiles: File[] = [];

        await run({
          entry: options.entry,
          outputDirectory: tempOutput,
          cacheDirectory: options.cacheDirectory,
          useWorker: false,
          onOutput: async (files) => {
            outputFiles = files;
          },
        });

        registerOutputFiles(outputFiles);
        activePipeline.resolve();
      }
    },

    async resolveId(source) {
      await activePipeline.promise;

      if (
        options.resolveImport?.({
          config: this.environment.getTopLevelConfig(),
          id: source,
        })
      ) {
        return source;
      }

      if (lastPipelineURLs.has(cleanUrl(source))) {
        return source;
      }
    },

    async load(id) {
      const config = this.environment.getTopLevelConfig();
      const cleanId = cleanUrl(id);

      if (options.resolveImport) {
        const module = options.resolveImport({ config, id });
        if (module) return module;
      }

      // Skip Rollup internal ids and non-pipeline URLs
      if (id[0] === "\0" || !lastPipelineURLs.has(cleanId)) {
        return;
      }

      const filePath = pipelineFileMap.get(cleanId)!;

      // ?raw: return file content as string
      if (isRawRequest(id)) {
        const content = await fsp.readFile(filePath, "utf-8");
        return `export default ${JSON.stringify(content)}`;
      }

      if (config.command === "build") {
        // Emit as a Rollup asset and use Rollup's native URL resolution
        const source = await fsp.readFile(filePath);
        const refId = this.emitFile({
          type: "asset",
          name: path.basename(filePath),
          source,
        });
        return {
          code: `export default import.meta.ROLLUP_FILE_URL_${refId};`,
          meta: { assetpipe: true },
        };
      }

      // Dev mode: return a URL pointing to the dev server
      const base = joinUrlSegments(
        config.server?.origin ?? "",
        config.base ?? "/",
      );
      const url = `${joinUrlSegments(base, cleanId)}?t=${lastBuildTimestamp}`;
      return `export default ${JSON.stringify(encodeURIPath(url))}`;
    },

    generateBundle(_, bundle) {
      // Remove empty entry point chunks that only import AssetPipe assets
      let importedFiles: Set<string> | undefined;
      for (const file in bundle) {
        const chunk = bundle[file];
        if (
          chunk.type === "chunk" &&
          chunk.isEntry &&
          chunk.moduleIds.length === 1 &&
          this.getModuleInfo(chunk.moduleIds[0])?.meta["assetpipe"]
        ) {
          if (!importedFiles) {
            importedFiles = new Set();
            for (const f in bundle) {
              const c = bundle[f];
              if (c.type === "chunk") {
                for (const imp of c.imports) importedFiles.add(imp);
                for (const imp of c.dynamicImports) importedFiles.add(imp);
              }
            }
          }
          if (!importedFiles.has(file)) {
            delete bundle[file];
          }
        }
      }
    },

    async closeBundle() {
      await fsp.rm(tempOutput, { recursive: true, force: true });
    },

    async configureServer(server) {
      await fsp.mkdir(tempOutput, { recursive: true });

      let firstExecution = true;

      const watcher = new PipelineWatcher({
        entry: options.entry,
        outputDirectory: tempOutput,
        cacheDirectory: options.cacheDirectory,
        useWorker: false,
        onOutput: (files) => {
          registerOutputFiles(files);

          if (!activePipeline.resolved) {
            activePipeline.resolve();
          }

          if (!firstExecution) {
            if (options.handleReload) {
              options.handleReload({ server, files });
            } else {
              server.hot.send({ type: "full-reload" });
            }
          }

          firstExecution = false;
        },
      });

      await watcher.spawn();

      const serve = sirv(tempOutput, {
        dev: true,
        etag: true,
        extensions: [],
        setHeaders(res, pathname) {
          if (/\.[tj]sx?$/.test(pathname)) {
            res.setHeader("Content-Type", "text/javascript");
          }
          const headers = server.config.server.headers;
          if (headers) {
            for (const name in headers) {
              const header = headers[name];
              if (header) res.setHeader(name, header);
            }
          }
        },
      });

      const urlPrefix = options.outputDirectory
        ? `/${options.outputDirectory}`
        : "";

      server.middlewares.use(function assetpipeMiddleware(req, res, next) {
        if (
          isImportRequest(req.url!) ||
          isInternalRequest(req.url!) ||
          isUrlRequest(req.url!)
        ) {
          return next();
        }

        const filePath = toFilePath(req.url!);
        if (lastPipelineURLs.has(filePath)) {
          // Strip the outputDirectory prefix so sirv can find the file
          if (urlPrefix && req.url!.startsWith(urlPrefix)) {
            req.url = req.url!.slice(urlPrefix.length) || "/";
          }
          return serve(req, res, next);
        }

        return next();
      });

      const originalClose = server.close;
      server.close = async () => {
        await watcher.despawn();
        await fsp.rm(tempOutput, { recursive: true, force: true });
        return originalClose.call(server);
      };
    },
  };
}
