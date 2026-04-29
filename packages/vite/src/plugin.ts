import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  type ExecutionMetadata,
  PipelineWatcher,
  run,
} from "@assetpipe/core/runtime";
import type { File } from "@assetpipe/core/types";
import sirv from "sirv";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

import {
  cleanUrl,
  createPromise,
  isImportRequest,
  isInternalRequest,
  isRawRequest,
  slash,
  toFilePath,
} from "./utils";
import { encodeURIPath } from "./utils/encodeURIPath";
import { joinUrlSegments } from "./utils/joinUrlSegments";
import { isParsableRequest } from "./utils/viteRequests";

export interface AssetpipePluginOptions {
  /**
   * Path to the AssetPipe pipeline entry file.
   *
   * Supports *.js, *.ts, *.mjs, *.cjs, *.mts, *.cts file extensions.
   */
  entry: string;

  /**
   * Path to the cache directory.
   *
   * Setting this to `undefined` disables caching.
   *
   * @default ".assetpipe/cache"
   */
  cacheDirectory?: string;

  /**
   * @default ".assetpipe/output"
   */
  outputDirectory?: string;

  /**
   * Prefix for pipeline imports.
   *
   * @example
   * ```ts
   * import hero from "/assets/hero.png";
   * ```
   *
   * @default "/"
   */
  prefix?: string;

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
    metadata: ExecutionMetadata;
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

export function assetpipe(_pluginOptions: AssetpipePluginOptions): Plugin {
  const options = {
    entry: _pluginOptions.entry,
    outputDirectory: slash(
      _pluginOptions.outputDirectory || ".assetpipe/output",
    ),
    cacheDirectory:
      "cacheDirectory" in _pluginOptions
        ? _pluginOptions.cacheDirectory
        : ".assetpipe/cache",
    prefix: _pluginOptions.prefix || "/",
    handleReload: _pluginOptions.handleReload,
    resolveImport: _pluginOptions.resolveImport,
  };

  let lastBuildTimestamp = -1;
  const activePipeline = createPromise();
  // Maps pipeline key (e.g. "/test.txt") → assetpipe's file object
  const pipelineFileMap = new Map<string, File>();
  // Maps pipeline key (e.g. "/test.txt") → set of module ids (e.g. "\0assetpipe:/test.txt?raw")
  const pipelineModuleIds = new Map<string, Set<string>>();

  function registerOutputFiles(files: File[]) {
    pipelineFileMap.clear();

    files.forEach((file) => {
      pipelineFileMap.set(
        path.posix.join("/", slash(file.dirname), file.basename),
        file,
      );
    });

    lastBuildTimestamp = Date.now();
  }

  const resolvedImports = {} as Record<string, string | undefined | null>;
  function resolveImport(config: ResolvedConfig, id: string) {
    if (!options.resolveImport) return;

    const oldModule = resolvedImports[id];
    if (oldModule) {
      return oldModule;
    } else if (oldModule === null) {
      return;
    }

    const newModule = options.resolveImport({ config, id });
    if (newModule) {
      return newModule;
    } else {
      return (resolvedImports[id] = null);
    }
  }

  return {
    name: "assetpipe",

    enforce: "pre",

    async configResolved(config) {
      if (config.command === "build") {
        await mkdir(options.outputDirectory, { recursive: true });

        let outputFiles: File[] = [];

        await run({
          entry: options.entry,
          outputDirectory: options.outputDirectory,
          cacheDirectory: options.cacheDirectory,
          onOutput: async (files) => {
            outputFiles = files;
          },
        });

        registerOutputFiles(outputFiles);
        activePipeline.resolve();
      }
    },

    async resolveId(source) {
      const config = this.environment.getTopLevelConfig();

      if (!source.startsWith(options.prefix)) {
        return;
      }

      await activePipeline.promise;

      const module = resolveImport(config, source);
      if (module) return source;

      const withoutPrefix = `/${source.slice(options.prefix.length)}`; // "@/test.txt?raw" → "/test.txt?raw"
      const pipelinePath = cleanUrl(withoutPrefix); // "/test.txt"

      if (pipelineFileMap.has(pipelinePath)) {
        const moduleId = `\0assetpipe:${withoutPrefix}`;
        let ids = pipelineModuleIds.get(pipelinePath);
        if (!ids) {
          ids = new Set();
          pipelineModuleIds.set(pipelinePath, ids);
        }
        ids.add(moduleId);
        return moduleId;
      }
    },

    async load(id) {
      const config = this.environment.getTopLevelConfig();

      // if (id.startsWith("\0assetpipeImport:")) {
      const module = resolveImport(config, id);
      if (module) return module;
      // }

      if (!id.startsWith("\0assetpipe:")) {
        return;
      }

      id = id.slice("\0assetpipe:".length);
      const cleanId = cleanUrl(id);

      const file = pipelineFileMap.get(cleanId)!;

      if (isParsableRequest(id)) {
        return readFile(file.content, "utf-8");
      }

      // ?raw: return file content as string
      if (isRawRequest(id)) {
        return `export default ${JSON.stringify(await readFile(file.content, "utf-8"))}`;
      }

      if (config.command === "build") {
        // Emit as a Rollup asset and use Rollup's native URL resolution
        const source = await readFile(file.content);
        const refId = this.emitFile({
          type: "asset",
          name: path.basename(file.content),
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

    async configureServer(server) {
      let firstExecution = true;

      const watcher = new PipelineWatcher({
        entry: options.entry,
        outputDirectory: options.outputDirectory,
        cacheDirectory: options.cacheDirectory,
        useWorker: false,
        onOutput: (files, metadata) => {
          if (!metadata) {
            throw new Error(
              "Something wrong with execution metadata generation",
            );
          }

          registerOutputFiles(files);

          if (!activePipeline.resolved) {
            activePipeline.resolve();
          }

          if (!firstExecution) {
            const environments = Object.values(server.environments);

            const invalidateFile = (file: File) => {
              const key = path.posix.join(
                "/",
                slash(file.dirname),
                file.basename,
              );
              const moduleIds = pipelineModuleIds.get(key);
              if (!moduleIds) return;

              moduleIds.forEach((moduleId) => {
                for (let i = 0; i < environments.length; i++) {
                  const moduleGraph = environments[i].moduleGraph;
                  const mod = moduleGraph.getModuleById(moduleId);
                  if (mod) {
                    moduleGraph.invalidateModule(mod);
                  }
                }
              });
            };

            metadata.changedFiles.forEach(invalidateFile);
            metadata.removedFiles.forEach((file) => {
              invalidateFile(file);
              const key = path.posix.join(
                "/",
                slash(file.dirname),
                file.basename,
              );
              pipelineModuleIds.delete(key);
            });

            if (options.handleReload) {
              options.handleReload({ server, files, metadata });
            } else {
              server.hot.send({ type: "full-reload" });
            }
          }

          firstExecution = false;
        },
      });

      await watcher.spawn();

      const serve = sirv(options.outputDirectory, {
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

      const urlPrefix = `/${options.outputDirectory}`;

      server.middlewares.use(function assetpipeMiddleware(req, res, next) {
        if (isImportRequest(req.url!) || isInternalRequest(req.url!)) {
          return next();
        }

        if (req.url && pipelineFileMap.has(toFilePath(req.url))) {
          if (urlPrefix && req.url.startsWith(urlPrefix)) {
            req.url = req.url.slice(urlPrefix.length) || "/";
          }
          return serve(req, res, next);
        }

        return next();
      });

      const originalClose = server.close;
      server.close = async () => {
        await watcher.despawn();
        return originalClose.call(server);
      };
    },
  };
}
