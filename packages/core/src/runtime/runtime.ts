import path from "path";
import { readdir, stat } from "fs/promises";
import picomatch from "picomatch";

import {
  ContextPipeline,
  GroupPipeline,
  IgnorePipeline,
  InteractivePipeline,
  QueryPipeline,
  Pipeline,
} from "../pipelines";
import { clonePipeline } from "../utils";
import { File } from "../types";
import { PipelineCache } from "./cache";
import { createPipelineRuntime, CreateRuntimeOptions } from "./factory";

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
            path.join(parent.context, query).replace(/\\/g, "/")
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
          () => false
        );

        if (!exists) {
          throw new Error(
            `[${query}] Query error. File ${basePath} not found.`
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
        (file) => !occupiedFiles.has(file.content)
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
      (_resolve) => (resolve = _resolve)
    );

    if (this.cache && parent.cacheHit && this.cache.has(parent.id.toString())) {
      parent.result = this.cache.read(parent.id.toString());

      resolve();
      return parent.resultPromise;
    }

    signal?.throwIfAborted();

    if (GroupPipeline.is(parent)) {
      let files: File[] = [];

      await Promise.all(
        parent.children.map((child) => this.computeResult(child, signal))
      );

      for (const child of parent.children) {
        if (InteractivePipeline.is(child)) {
          files.push(...child.result);
        }
      }

      parent.result = await this.executeCommands(parent, files, signal);
      this.cache?.write(parent.id.toString(), parent.result);

      signal?.throwIfAborted();
      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent) && parent.bulk) {
      parent.result = await this.executeCommands(
        parent,
        parent.filteredQueryResult,
        signal
      );
      this.cache?.write(parent.id.toString(), parent.result);
      signal?.throwIfAborted();
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

      if (this.cache) {
        for (const tag in tagMap) {
          let hasCacheMisses = false;

          for (const file of tagMap[tag]) {
            if (parent.cacheMisses.has(file.content)) {
              hasCacheMisses = true;
              break;
            }
          }

          const cacheKey = parent.id + "@" + tag;

          if (!hasCacheMisses && this.cache.has(cacheKey)) {
            const files = this.cache.read(parent.id + "@" + tag);
            parent.result.push(...files);
          } else {
            const files = await this.executeCommands(
              parent,
              tagMap[tag],
              signal
            );
            parent.result.push(...files);
          }
        }
      } else {
        for (const tag in tagMap) {
          const files = await this.executeCommands(parent, tagMap[tag], signal);
          parent.result.push(...files);
        }
      }

      signal?.throwIfAborted();
      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent)) {
      parent.result = [];

      if (this.cache) {
        for (const file of parent.filteredQueryResult) {
          const cacheKey = parent.id + "$" + file.content;

          if (
            !parent.cacheMisses.has(file.content) &&
            this.cache.has(cacheKey)
          ) {
            const files = this.cache.read(cacheKey);
            parent.result.push(...files);
          } else {
            const files = await this.executeCommands(parent, [file], signal);
            this.cache.write(cacheKey, files);
            parent.result.push(...files);
          }
        }
      } else {
        for (const file of parent.filteredQueryResult) {
          const files = await this.executeCommands(parent, [file], signal);
          parent.result.push(...files);
        }
      }

      signal?.throwIfAborted();
      resolve();
      return parent.resultPromise;
    }
  }

  private async executeCommands(
    parent: InteractivePipeline,
    inputs: File[],
    signal?: AbortSignal
  ) {
    let output = inputs;

    for (let i = 0; i < parent.commands.length; i++) {
      const command = parent.commands[i];

      signal?.throwIfAborted();

      switch (command.type) {
        case "pipe":
          output = await command.transformer(output);
          break;

        case "branch":
          output = await Promise.all(
            command.transformers.map((transformer) => transformer(output))
          ).then((results) => results.flat());
          break;

        case "pull":
          const pulls: Pipeline[] = [command.pipeline];

          let offset = 1;
          let nextCommand = parent.commands[i + offset];
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
            })
          );
          break;
      }
    }

    return output;
  }
}
