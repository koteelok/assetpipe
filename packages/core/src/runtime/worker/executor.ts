import { readdir } from "fs/promises";
import path from "path";

import type { IgnorePipeline, Pipeline } from "../../pipelines";
import {
  GroupPipeline,
  InteractivePipeline,
  QueryPipeline,
} from "../../pipelines";
import { File } from "../../types";
import { AssetpipeCacheOptions, PipelineCacheManager } from "./cache";
import { PipelineState } from "./state";
import { exists } from "../../utils";
import { AssetpipeOptionsWithDefaults } from "../options";

declare global {
  var CURRENT_TEMP_DIR: string | undefined;
}

export class PipelineExecutor {
  public state!: PipelineState;
  public cache?: PipelineCacheManager;
  private abortController?: AbortController;
  private options!: AssetpipeOptionsWithDefaults;

  public async init(options: AssetpipeOptionsWithDefaults): Promise<void> {
    this.options = options;

    this.state = await PipelineState.create(this.options);

    if (this.options.cacheDirectory) {
      // typecript is dumb lol
      this.cache = new PipelineCacheManager(
        this.state,
        this.options as AssetpipeCacheOptions
      );
      await this.cache.init();
    }
  }

  public abort(): void {
    this.abortController?.abort();
  }

  private async executeQuery(pipeline: QueryPipeline | IgnorePipeline) {
    pipeline.queryResult = [];

    for (const query of pipeline.query) {
      const state = pipeline.states[query];
      const basePath = path.resolve(this.options.queryBase, state.base);

      switch (state.kind) {
        case "file": {
          if (!(await exists(basePath))) {
            throw new Error(
              `[${query}] Query error. File ${basePath} not found.`,
            );
          }

          pipeline.queryResult.push(
            new File({ target: path.basename(state.base), content: basePath }),
          );
          break;
        }

        case "glob": {
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

            const relative = path
              .relative(basePath, fullPath)
              .replaceAll(path.sep, "/");
            pipeline.queryResult.push(new File({ target: relative, content: fullPath }));
          }
          break;
        }
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

  public submitQueryCacheMiss(
    pipelineIndex: number,
    queryIndex: number,
    eventType: string,
    eventPath: string,
  ): void {
    const pipeline = this.state.queryPipelines[pipelineIndex];
    const query = pipeline.query[queryIndex];
    const state = pipeline.states[query];
    if (eventType === "create") {
      const basePath = path.resolve(this.options.queryBase, state.base);
      const relative = path
        .relative(basePath, eventPath)
        .replaceAll(path.sep, "/");
      const file = new File({ target: relative, content: eventPath });
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
    pipeline.pendingCacheMisses.add(eventPath);
  }

  public async computePipelineOutput(tempDirectory: string) {
    this.abortController?.abort();
    this.abortController = new AbortController();

    this.cache?.drainPendingCacheMisses();

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
      for (let i = 0; i < pipeline.queryResult.length; i++) {
        const file = pipeline.queryResult[i];
        occupiedFiles.add(file.content);
      }
    }

    for (const pipeline of this.state.queryPipelines) {
      for (let i = 0; i < pipeline.queryResult.length; i++) {
        const file = pipeline.queryResult[i];
        if (!occupiedFiles.has(file.content)) {
          pipeline.filteredQueryResult.push(file);
        }
      }

      if (pipeline.claim) {
        for (let i = 0; i < pipeline.queryResult.length; i++) {
          const file = pipeline.queryResult[i];
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
      const isSlicedQuery =
        QueryPipeline.is(parent) &&
        (parent.parallel || parent.groupBy !== undefined);

      if (parent.firstDirtyPull !== undefined && !isSlicedQuery) {
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
      } else if (parent.firstDirtyPull === undefined) {
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
      if (parent.source) {
        await this.computeResult(parent.source, signal);
        const input = InteractivePipeline.is(parent.source)
          ? parent.source.result
          : [];

        parent.result = await this.executeCommands(parent, input, signal);

        this.cache?.writeResult(this.cache.pipelineKey(parent), parent.result);

        resolve();
        return parent.resultPromise;
      }

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

    if (QueryPipeline.is(parent) && parent.source) {
      await this.computeResult(parent.source, signal);
      const source = parent.source;
      const sourceHasSlices =
        QueryPipeline.is(source) && source.slices !== undefined;

      if (sourceHasSlices) {
        const pullDirty = parent.firstDirtyPull !== undefined;
        parent.slices = await Promise.all(
          source.slices!.map(async (src) => {
            const key = this.cache?.cloneSliceKey(parent, src.key);
            const dirty = src.dirty || pullDirty;

            if (!dirty && this.cache && key !== undefined) {
              const cached = this.cache.readResult(key);
              if (cached) {
                return { key: src.key, output: cached, dirty: false };
              }
            }

            const out = await this.executeSliceCommands(
              parent,
              src.key,
              src.output,
              src.dirty,
              signal,
            );

            if (this.cache && key !== undefined) {
              this.cache.writeResult(key, out);
            }
            return { key: src.key, output: out, dirty };
          }),
        );
        parent.result = parent.slices.flatMap((s) => s.output);
      } else {
        const input = InteractivePipeline.is(source) ? source.result : [];
        parent.result = await this.executeCommands(parent, input, signal);
        this.cache?.writeResult(this.cache.pipelineKey(parent), parent.result);
      }

      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent) && parent.parallel) {
      const pullDirty = parent.firstDirtyPull !== undefined;
      parent.slices = await Promise.all(
        parent.filteredQueryResult.map(async (file) => {
          const inputDirty = parent.activeCacheMisses.has(file.content);
          const dirty = inputDirty || pullDirty;
          const key = this.cache?.queryFileKey(parent, file);

          if (!dirty && this.cache && key !== undefined) {
            const cached = this.cache.readResult(key);
            if (cached) {
              return { key: file.content, output: cached, dirty: false };
            }
          }

          const out = await this.executeSliceCommands(
            parent,
            file.content,
            [file],
            inputDirty,
            signal,
          );

          if (this.cache && key !== undefined) {
            this.cache.writeResult(key, out);
          }
          return { key: file.content, output: out, dirty };
        }),
      );
      parent.result = parent.slices.flatMap((s) => s.output);

      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent) && parent.groupBy !== undefined) {
      const tagMap: Record<string, File[]> = {};

      for (const file of parent.filteredQueryResult) {
        const tag = parent.groupBy(file);
        if (tagMap[tag] === undefined) {
          tagMap[tag] = [];
        }
        tagMap[tag].push(file);
      }

      const pullDirty = parent.firstDirtyPull !== undefined;

      parent.slices = await Promise.all(
        Object.entries(tagMap).map(async ([tag, files]) => {
          let noCacheMisses = true;
          for (const file of files) {
            if (parent.activeCacheMisses.has(file.content)) {
              noCacheMisses = false;
              break;
            }
          }

          const key = this.cache?.queryGroupKey(parent, tag);
          const currentMembership = new Set(files.map((f) => f.content));

          let membershipUnchanged = false;
          if (this.cache && key !== undefined) {
            const previousMembership = this.cache.readGroupMembership(key);
            membershipUnchanged =
              previousMembership !== undefined &&
              previousMembership.symmetricDifference(currentMembership).size ===
                0;
          }

          const ownDirty = !noCacheMisses || !membershipUnchanged;
          const dirty = ownDirty || pullDirty;

          if (!dirty && this.cache && key !== undefined) {
            const cached = this.cache.readResult(key);
            if (cached) {
              return { key: tag, output: cached, dirty: false };
            }
          }

          const out = await this.executeSliceCommands(
            parent,
            tag,
            files,
            ownDirty,
            signal,
          );

          if (this.cache && key !== undefined) {
            this.cache.writeResult(key, out);
            this.cache.writeGroupMembership(key, currentMembership);
          }
          return { key: tag, output: out, dirty };
        }),
      );
      parent.result = parent.slices.flatMap((s) => s.output);

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

  private async executeSliceCommands(
    parent: InteractivePipeline,
    sliceKey: string,
    fullInput: File[],
    inputDirty: boolean,
    signal: AbortSignal,
  ): Promise<File[]> {
    if (!inputDirty && parent.firstDirtyPull !== undefined && this.cache) {
      const prePullCached = this.cache.readResult(
        this.cache.beforePullSliceKey(parent, parent.firstDirtyPull, sliceKey),
      );
      if (prePullCached) {
        return this.executeCommands(
          parent,
          prePullCached,
          signal,
          parent.firstDirtyPull,
          sliceKey,
        );
      }
    }
    return this.executeCommands(parent, fullInput, signal, 0, sliceKey);
  }

  private async executeCommands(
    parent: InteractivePipeline,
    inputs: File[],
    signal: AbortSignal,
    startIndex: number = 0,
    sliceKey?: string,
  ) {
    let output: File[] = inputs;

    for (let i = startIndex; i < parent.commands.length; i++) {
      const command = parent.commands[i];

      signal.throwIfAborted();

      switch (command.type) {
        case "pipe":
          output = (await command.transformer(output)).slice();
          break;

        case "branch":
          output = await Promise.all(
            command.transformers.map((transformer) =>
              transformer(output.slice()),
            ),
          ).then((results) => results.flat());
          break;

        case "pull":
          if (this.cache) {
            if (sliceKey !== undefined) {
              this.cache.writeResult(
                this.cache.beforePullSliceKey(parent, i, sliceKey),
                output,
              );
            } else {
              this.cache.writeResult(
                this.cache.beforePullKey(parent, i),
                output,
              );
            }
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
