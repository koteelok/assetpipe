import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import { readdir, stat } from "fs/promises";
import path from "path";
import { parentPort } from "worker_threads";

import type { IgnorePipeline, Pipeline } from "../../pipelines";
import {
  GroupPipeline,
  InteractivePipeline,
  QueryPipeline,
} from "../../pipelines";
import type { File } from "../../types";
import type { AssetpipeOptions } from "../options";
import { PipelineCache } from "./cache";
import { PipelineState } from "./state";

declare global {
  var CURRENT_CACHE: PipelineCache | undefined;
}

export interface IgnoreInfo {
  context: string;
  query: string[];
}

export interface QueryInfo {
  context: string;
  query: string[];
  states: Record<
    string,
    {
      base: string;
      glob: string;
    }
  >;
}

export class PipelineExecutorApi {
  public state!: PipelineState;
  public cache?: PipelineCache;
  private abortController?: AbortController;

  public async init(options: AssetpipeOptions) {
    this.state = await PipelineState.create(options);

    if (options.cacheDirectory) {
      this.cache = new PipelineCache(this.state, {
        entry: options.entry,
        outputDirectory: options.outputDirectory,
        cacheDirectory: options.cacheDirectory,
      });
      await this.cache.init();
    }

    const ignores: IgnoreInfo[] = [];
    for (const pipeline of this.state.ignorePipelines) {
      ignores.push({
        context: pipeline.context,
        query: pipeline.query,
      });
    }

    const queries: QueryInfo[] = [];
    for (const pipeline of this.state.queryPipelines) {
      queries.push({
        context: pipeline.context,
        query: pipeline.query,
        states: pipeline.query.reduce((acc, query) => {
          const state = pipeline.states[query];
          acc[query] = {
            base: state.base,
            glob: state.glob,
          };
          return acc;
        }, {} as any),
      });
    }

    return { ignores, queries };
  }

  public abort() {
    this.abortController?.abort();
  }

  public async saveResultsToCache(): Promise<void> {
    return this.cache?.saveResults();
  }

  public async loadResultsFromCache(): Promise<void> {
    return this.cache?.loadResults();
  }

  public async hitQueriesAgainstCache(cwd = process.cwd()): Promise<void> {
    return this.cache?.hitQueries(cwd);
  }

  public async restoreCacheFromBackup(): Promise<void> {
    return this.cache?.restoreFromBackup();
  }

  public async executeQuery(
    pipeline: QueryPipeline | IgnorePipeline,
    cwd = process.cwd(),
  ) {
    pipeline.queryResult = [];

    for (const query of pipeline.query) {
      const state = pipeline.states[query];
      const basePath = path.resolve(cwd, state.base);

      if (state.glob === "") {
        const exists = await stat(basePath).then(
          () => true,
          () => false,
        );

        if (!exists) {
          throw new Error(
            `[${query}] Query error. File ${basePath} not found.`,
          );
        }

        pipeline.queryResult.push({
          dirname: "",
          basename: path.basename(state.base),
          content: basePath,
        });

        continue;
      }

      const dirents = await readdir(basePath, {
        recursive: true,
        withFileTypes: true,
      }).catch(() => []);

      if (dirents.length === 0) continue;

      const matcher = pipeline.matchers[query];

      for (const dirent of dirents) {
        if (!dirent.isFile()) continue;

        const fullPath = path.join(dirent.parentPath, dirent.name);
        const isMatch = matcher(path.relative(basePath, fullPath));

        if (!isMatch) continue;

        pipeline.queryResult.push({
          basename: dirent.name,
          dirname: path.relative(basePath, dirent.parentPath),
          content: fullPath,
        });
      }
    }
  }

  public async executeAllQueries(cwd?: string) {
    const pendingQueries: Promise<void>[] = [];

    for (const pipeline of this.state.queryPipelines) {
      pendingQueries.push(this.executeQuery(pipeline, cwd));
    }

    for (const pipeline of this.state.ignorePipelines) {
      pendingQueries.push(this.executeQuery(pipeline, cwd));
    }

    return Promise.all(pendingQueries);
  }

  public submitQueryCacheMiss(
    pipelineIndex: number,
    queryIndex: number,
    eventType: string,
    eventPath: string,
  ) {
    const pipeline = this.state.queryPipelines[pipelineIndex];
    const query = pipeline.query[queryIndex];
    const state = pipeline.states[query];
    if (eventType === "create") {
      pipeline.queryResult.push({
        basename: path.basename(eventPath),
        dirname: path.relative(
          path.resolve(state.base),
          path.dirname(eventPath),
        ),
        content: eventPath,
      });
    } else if (eventType === "delete") {
      for (let i = pipeline.queryResult.length - 1; i >= 0; i--) {
        if (pipeline.queryResult[i].content === eventPath) {
          pipeline.queryResult.splice(i, 1);
        }
      }
    }
    pipeline.cacheHit = false;
    pipeline.cacheMisses.add(eventPath);
  }

  public async computePipelineResults() {
    this.abortController?.abort();
    this.abortController = new AbortController();

    if (InteractivePipeline.is(this.state.root)) {
      this.filterAllQueryResults();

      if (this.cache) {
        this.cache.computeCacheHits(this.state.root);
        globalThis.CURRENT_CACHE = this.cache;
      }

      for (const pipeline of this.state.interactivePipelines) {
        pipeline.resultPromise = undefined;
      }

      await this.computeResult(this.state.root, this.abortController.signal);

      if (this.cache) {
        globalThis.CURRENT_CACHE = undefined;
      }

      return this.state.root.result;
    }
  }

  private filterAllQueryResults() {
    const occupiedFiles = new Set<string>();

    for (const pipeline of this.state.ignorePipelines) {
      for (const file of pipeline.queryResult) {
        occupiedFiles.add(file.content);
      }
    }

    for (const pipeline of this.state.queryPipelines) {
      pipeline.filteredQueryResult = pipeline.queryResult.filter(
        (file) => !occupiedFiles.has(file.content),
      );

      if (pipeline.claim) {
        for (const file of pipeline.queryResult) {
          occupiedFiles.add(file.content);
        }
      }
    }
  }

  private async computeResult(parent: Pipeline, signal: AbortSignal) {
    if (!InteractivePipeline.is(parent)) {
      return;
    }

    if (parent.resultPromise) {
      return parent.resultPromise;
    }

    let resolve!: (result: void) => void;
    parent.resultPromise = new Promise<void>(
      (_resolve) => (resolve = _resolve),
    );

    if (this.cache && parent.cacheHit) {
      if (parent.firstDirtyPull !== undefined) {
        const cachedFiles = this.cache.read(
          this.cache.beforePullKey(parent, parent.firstDirtyPull),
        );

        if (cachedFiles) {
          parent.result = await this.executeCommands(
            parent,
            cachedFiles,
            signal,
            parent.firstDirtyPull,
          );

          this.cache.write(this.cache.pipelineKey(parent), parent.result);

          resolve();
          return parent.resultPromise;
        }
      } else {
        const cachedFiles = this.cache.read(this.cache.pipelineKey(parent));

        if (cachedFiles) {
          parent.result = cachedFiles;
          resolve();
          return parent.resultPromise;
        }
      }
    }

    signal.throwIfAborted();

    if (GroupPipeline.is(parent)) {
      const files: File[] = [];

      await Promise.all(
        parent.children.map((child) => this.computeResult(child, signal)),
      );

      for (const child of parent.children) {
        if (InteractivePipeline.is(child)) {
          files.push(...child.result);
        }
      }

      parent.result = await this.executeCommands(parent, files, signal);

      this.cache?.write(this.cache.pipelineKey(parent), parent.result);

      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent) && parent.bulk) {
      parent.result = await this.executeCommands(
        parent,
        parent.filteredQueryResult,
        signal,
      );

      this.cache?.write(this.cache.pipelineKey(parent), parent.result);

      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent) && parent.groupBy !== undefined) {
      parent.result = [];

      const tagMap: Record<string, File[]> = {};

      for (const file of parent.filteredQueryResult) {
        const tag = parent.groupBy(file);
        if (tagMap[tag] === undefined) {
          tagMap[tag] = [];
        }
        tagMap[tag].push(file);
      }

      for (const tag in tagMap) {
        let noCacheMisses = true;

        for (const file of tagMap[tag]) {
          if (parent.cacheMisses.has(file.content)) {
            noCacheMisses = false;
            break;
          }
        }

        const cachedFiles =
          this.cache &&
          noCacheMisses &&
          this.cache.read(this.cache.queryGroupKey(parent, tag));

        if (cachedFiles) {
          parent.result.push(...cachedFiles);
        } else {
          const files = await this.executeCommands(parent, tagMap[tag], signal);
          parent.result.push(...files);
        }
      }

      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent)) {
      parent.result = [];

      for (const file of parent.filteredQueryResult) {
        const cachedFiles =
          this.cache &&
          !parent.cacheMisses.has(file.content) &&
          this.cache.read(this.cache.queryFileKey(parent, file));

        if (cachedFiles) {
          parent.result.push(...cachedFiles);
        } else {
          const files = await this.executeCommands(parent, [file], signal);
          this.cache?.write(this.cache.queryFileKey(parent, file), files);
          parent.result.push(...files);
        }
      }

      resolve();
      return parent.resultPromise;
    }
  }

  private async executeCommands(
    parent: InteractivePipeline,
    inputs: File[],
    signal: AbortSignal,
    startIndex: number = 0,
  ) {
    let output = inputs;

    for (let i = startIndex; i < parent.commands.length; i++) {
      const command = parent.commands[i];

      signal.throwIfAborted();

      switch (command.type) {
        case "pipe":
          output = await command.transformer(output);
          break;

        case "branch":
          output = await Promise.all(
            command.transformers.map((transformer) => transformer(output)),
          ).then((results) => results.flat());
          break;

        case "pull":
          this.cache?.write(this.cache.beforePullKey(parent, i), output);

          var pulls: Pipeline[] = [command.pipeline];

          var offset = 1;
          var nextCommand = parent.commands[i + offset];
          while (nextCommand && nextCommand.type === "pull") {
            pulls.push(nextCommand.pipeline);
            offset++;
            nextCommand = parent.commands[i + offset];
          }
          i += offset - 1;

          await Promise.all(
            pulls.map(async (pipeline) => {
              await this.computeResult(pipeline, signal);

              if (InteractivePipeline.is(pipeline)) {
                output.push(...pipeline.result);
              }
            }),
          );
          break;
      }
    }

    return output;
  }
}

if (parentPort) {
  comlink.expose(new PipelineExecutorApi(), nodeEndpoint(parentPort));
}
