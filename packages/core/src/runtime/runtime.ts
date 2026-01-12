import { readdir, stat } from "fs/promises";
import path from "path";
import picomatch from "picomatch";

import type { Pipeline } from "../pipelines";
import {
  ContextPipeline,
  GroupPipeline,
  IgnorePipeline,
  InteractivePipeline,
  QueryPipeline,
} from "../pipelines";
import type { File } from "../types";
import { clonePipeline } from "../utils";
import type { PipelineCache } from "./cache";
import type { CreateRuntimeOptions } from "./factory";
import { createPipelineRuntime } from "./factory";

export class PipelineRuntime {
  public root: Pipeline;
  public cache?: PipelineCache;
  public queryPipelines: QueryPipeline[] = [];
  public ignorePipelines: IgnorePipeline[] = [];
  public interactivePipelines: InteractivePipeline[] = [];

  static async from(options: CreateRuntimeOptions) {
    const { runtime } = await createPipelineRuntime(options);
    return runtime;
  }

  constructor(pipeline: Pipeline, cache?: PipelineCache) {
    this.root = clonePipeline(pipeline);
    this.cache = cache;
    this.prepassPipeline(this.root);
  }

  private prepassPipeline(parent: Pipeline, counter = 0, context = "") {
    if (parent.id !== undefined) {
      return parent.id;
    }

    parent.id = counter++;

    if (InteractivePipeline.is(parent)) {
      this.interactivePipelines.push(parent);
    }

    if (ContextPipeline.is(parent)) {
      context = context ? path.join(parent.context, context) : parent.context;
    }

    if (QueryPipeline.is(parent)) {
      parent.context = context;

      if (!this.queryPipelines.includes(parent)) {
        for (const query of parent.query) {
          const state = picomatch.scan(
            path.join(parent.context, query).replace(/\\/g, "/"),
          );
          const matcher = picomatch(state.glob, {
            windows: process.platform === "win32",
          });
          parent.states[query] = state;
          parent.matchers[query] = matcher;
        }

        this.queryPipelines.push(parent);
      }
    }

    if (IgnorePipeline.is(parent)) {
      parent.context = context;

      if (!this.ignorePipelines.includes(parent)) {
        this.ignorePipelines.push(parent);
      }
    }

    if (GroupPipeline.is(parent)) {
      for (const child of parent.children) {
        counter = this.prepassPipeline(child, counter, context);
      }
    }

    if (InteractivePipeline.is(parent)) {
      for (const command of parent.commands) {
        if (command.type === "pull") {
          counter = this.prepassPipeline(command.pipeline, counter);
        }
      }
    }

    return counter;
  }

  public async executeQuery(pipeline: QueryPipeline | IgnorePipeline) {
    pipeline.queryResult = [];

    for (const query of pipeline.query) {
      const state = pipeline.states[query];
      const basePath = path.resolve(process.cwd(), state.base);

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

      if (dirents.length === 0) return [];

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
    return Promise.all([
      ...this.queryPipelines.map((pipeline) => this.executeQuery(pipeline)),
      ...this.ignorePipelines.map((pipeline) => this.executeQuery(pipeline)),
    ]);
  }

  public async computePipelineResults(signal?: AbortSignal) {
    if (InteractivePipeline.is(this.root)) {
      this.filterAllQueryResults();

      if (this.cache) {
        this.computeCacheHits(this.root);
      }

      for (const pipeline of this.interactivePipelines) {
        pipeline.resultPromise = undefined;
      }

      await this.computeResult(this.root, signal);

      return this.root.result;
    }
  }

  private filterAllQueryResults() {
    const occupiedFiles = new Set<string>();

    for (const pipeline of this.ignorePipelines) {
      for (const file of pipeline.queryResult) {
        occupiedFiles.add(file.content);
      }
    }

    for (const pipeline of this.queryPipelines) {
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

  private async computeCacheHits(parent: Pipeline) {
    if (GroupPipeline.is(parent)) {
      parent.cacheHit = true;

      for (const child of parent.children) {
        this.computeCacheHits(child);

        if (InteractivePipeline.is(child) && !child.cacheHit) {
          parent.cacheHit = false;
          break;
        }
      }
    }

    if (QueryPipeline.is(parent)) {
      parent.cacheHit = parent.cacheMisses.size === 0;
    }

    if (InteractivePipeline.is(parent)) {
      parent.firstDirtyPull = undefined;

      for (let i = 0; i < parent.commands.length; i++) {
        const command = parent.commands[i];
        if (command.type === "pull") {
          this.computeCacheHits(command.pipeline);

          if (
            InteractivePipeline.is(command.pipeline) &&
            !command.pipeline.cacheHit
          ) {
            if (parent.firstDirtyPull === undefined) {
              parent.firstDirtyPull = i;
            }
          }
        }
      }
    }
  }

  private async computeResult(parent: Pipeline, signal?: AbortSignal) {
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

    signal?.throwIfAborted();

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

      if (this.cache) {
        this.cache.write(this.cache.pipelineKey(parent), parent.result);
      }

      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent) && parent.bulk) {
      parent.result = await this.executeCommands(
        parent,
        parent.filteredQueryResult,
        signal,
      );

      if (this.cache) {
        this.cache.write(this.cache.pipelineKey(parent), parent.result);
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
    signal?: AbortSignal,
    startIndex: number = 0,
  ) {
    let output = inputs;

    for (let i = startIndex; i < parent.commands.length; i++) {
      const command = parent.commands[i];

      signal?.throwIfAborted();

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
          if (this.cache) {
            this.cache.write(this.cache.beforePullKey(parent, i), output);
          }

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
