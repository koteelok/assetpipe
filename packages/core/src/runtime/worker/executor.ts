import { readdir } from "fs/promises";
import path from "path";

import type { IgnorePipeline, Pipeline } from "../../pipelines";
import {
  GroupPipeline,
  InteractivePipeline,
  QueryPipeline,
} from "../../pipelines";
import type { File } from "../../types";
import { PipelineCacheManager } from "./cache";
import { PipelineState } from "./state";
import { cloneFiles, exists } from "../../utils";
import { AssetpipeOptionsWithDefaults } from "../options";

declare global {
  var CURRENT_TEMP_DIR: string | undefined;
}

export class PipelineExecutor {
  public state!: PipelineState;
  public cache?: PipelineCacheManager;
  private abortController?: AbortController;
  private options!: AssetpipeOptionsWithDefaults;

  public async init(options: AssetpipeOptionsWithDefaults) {
    this.options = options;

    this.state = await PipelineState.create(this.options);

    if (this.options.cacheDirectory) {
      // typecript is dumb lol
      this.cache = new PipelineCacheManager(this.state, {
        cacheDirectory: this.options.cacheDirectory,
        ...this.options,
      });
      await this.cache.init();
    }

    return this.state.serialize();
  }

  public async abort() {
    this.abortController?.abort();
  }

  public async cacheTempDirectory() {
    return this.cache?.tempFilesPath;
  }

  public async saveResultsToCache(): Promise<void> {
    return this.cache?.saveResults();
  }

  public async loadResultsFromCache(): Promise<void> {
    return this.cache?.loadResults();
  }

  public async hitQueriesAgainstCache(): Promise<void> {
    return this.cache?.hitQueries();
  }

  public async restoreCacheFromBackup(): Promise<void> {
    return this.cache?.restoreFromBackup();
  }

  public async getCacheRedundantTempFiles() {
    return this.cache?.getRedundantTempFiles();
  }

  public async getExecutionMetadata() {
    return this.cache?.getExecutionMetadata();
  }

  private async executeQuery(pipeline: QueryPipeline | IgnorePipeline) {
    pipeline.queryResult = [];

    for (const query of pipeline.query) {
      const state = pipeline.states[query];
      const basePath = path.resolve(this.options.queryBase, state.base);

      if (state.glob === "") {
        if (!(await exists(basePath))) {
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

  public async executeAllQueries() {
    await Promise.all([
      ...this.state.queryPipelines.map((pipeline) =>
        this.executeQuery(pipeline),
      ),
      ...this.state.ignorePipelines.map((pipeline) =>
        this.executeQuery(pipeline),
      ),
    ]);

    this.filterAllQueryResults();
  }

  public async submitQueryCacheMiss(
    pipelineIndex: number,
    queryIndex: number,
    eventType: string,
    eventPath: string,
  ) {
    const pipeline = this.state.queryPipelines[pipelineIndex];
    const query = pipeline.query[queryIndex];
    const state = pipeline.states[query];
    if (eventType === "create") {
      const file = {
        basename: path.basename(eventPath),
        dirname: path.relative(
          path.resolve(this.options.queryBase, state.base),
          path.dirname(eventPath),
        ),
        content: eventPath,
      };
      pipeline.queryResult.push(file);
      pipeline.filteredQueryResult.push(file);
    } else if (eventType === "delete") {
      for (let i = pipeline.queryResult.length - 1; i >= 0; i--) {
        if (pipeline.queryResult[i].content === eventPath) {
          pipeline.queryResult.splice(i, 1);
        }
      }
      for (let i = pipeline.filteredQueryResult.length - 1; i >= 0; i--) {
        if (pipeline.filteredQueryResult[i].content === eventPath) {
          pipeline.filteredQueryResult.splice(i, 1);
        }
      }
    }
    pipeline.cacheHit = false;
    pipeline.cacheMisses.add(eventPath);
  }

  public async computePipelineOutput(tempDirectory: string) {
    this.abortController?.abort();
    this.abortController = new AbortController();

    if (InteractivePipeline.is(this.state.root)) {
      this.cache?.waterfallCacheHits(this.state.root);

      for (const pipeline of this.state.interactivePipelines) {
        pipeline.resultPromise = undefined;
      }

      globalThis.CURRENT_TEMP_DIR = tempDirectory;
      await this.computeResult(this.state.root, this.abortController.signal);
      globalThis.CURRENT_TEMP_DIR = undefined;

      this.cache?.writeOutput(this.state.root.result);

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
        const cachedFiles = this.cache.readResult(
          this.cache.beforePullKey(parent, parent.firstDirtyPull),
        );

        if (cachedFiles) {
          parent.result = await this.executeCommands(
            parent,
            cachedFiles,
            signal,
            parent.firstDirtyPull,
          );

          this.cache.writeResult(this.cache.pipelineKey(parent), parent.result);

          resolve();
          return parent.resultPromise;
        }
      } else {
        const cachedFiles = this.cache.readResult(
          this.cache.pipelineKey(parent),
        );

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

      this.cache?.writeResult(this.cache.pipelineKey(parent), parent.result);

      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent) && parent.parallel) {
      parent.result = [];

      for (const file of parent.filteredQueryResult) {
        const cachedFiles =
          this.cache &&
          !parent.cacheMisses.has(file.content) &&
          this.cache.readResult(this.cache.queryFileKey(parent, file));

        if (cachedFiles) {
          parent.result.push(...cachedFiles);
        } else {
          const files = await this.executeCommands(parent, [file], signal);
          this.cache?.writeResult(this.cache.queryFileKey(parent, file), files);
          parent.result.push(...files);
        }
      }

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
          this.cache.readResult(this.cache.queryGroupKey(parent, tag));

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
      parent.result = await this.executeCommands(
        parent,
        parent.filteredQueryResult,
        signal,
      );

      this.cache?.writeResult(this.cache.pipelineKey(parent), parent.result);

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
          output = await command.transformer(cloneFiles(output));
          break;

        case "branch":
          output = await Promise.all(
            command.transformers.map((transformer) =>
              transformer(cloneFiles(output)),
            ),
          ).then((results) => results.flat());
          break;

        case "pull":
          this.cache?.writeResult(this.cache.beforePullKey(parent, i), output);

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
