import { readdir } from "fs/promises";
import path from "path";

import type { IgnorePipeline, Pipeline, Slice } from "../../pipelines";
import {
  ClonePipeline,
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

      switch (state.kind) {
        case "file": {
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

            pipeline.queryResult.push({
              basename: dirent.name,
              dirname: path.relative(basePath, dirent.parentPath),
              content: fullPath,
            });
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
    pipeline.pendingCacheMisses.add(eventPath);
  }

  public async drainActiveCacheMisses(): Promise<void> {
    this.cache?.drainActiveCacheMisses();
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
      if (parent.firstDirtyPull !== undefined) {
        const cachedFiles = this.cache.readBeforePull(
          this.cache.pipelineKey(parent),
          parent.firstDirtyPull,
        );

        if (cachedFiles) {
          parent.result = await this.executeCommands(
            parent,
            cachedFiles,
            signal,
            parent.firstDirtyPull,
            this.monolithicSnapshotPolicy(parent),
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

    if (ClonePipeline.is(parent)) {
      await this.computeResult(parent.source, signal);

      const source = parent.source;
      const sliced =
        (QueryPipeline.is(source) || ClonePipeline.is(source)) &&
        source.slices !== undefined;

      if (sliced) {
        await Promise.all(
          parent.commands.map(
            (command) =>
              command.type === "pull" &&
              this.computeResult(command.pipeline, signal),
          ),
        );

        parent.slices = await Promise.all(
          source.slices!.map((src) =>
            this.executeSlice(
              parent,
              src.key,
              this.cache?.cloneSliceKey(parent, src.key),
              src.output,
              src.dirty,
              signal,
              false,
            ),
          ),
        );
        parent.result = parent.slices.flatMap((s) => s.output);
      } else {
        const input = InteractivePipeline.is(source) ? source.result : [];
        parent.result = await this.executeCommands(
          parent,
          input,
          signal,
          0,
          this.monolithicSnapshotPolicy(parent),
        );
        this.cache?.writeResult(this.cache.pipelineKey(parent), parent.result);
      }

      resolve();
      return parent.resultPromise;
    }

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

      parent.result = await this.executeCommands(
        parent,
        files,
        signal,
        0,
        this.monolithicSnapshotPolicy(parent),
      );

      this.cache?.writeResult(this.cache.pipelineKey(parent), parent.result);

      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent) && parent.parallel) {
      await Promise.all(
        parent.commands.map(
          (command) =>
            command.type === "pull" &&
            this.computeResult(command.pipeline, signal),
        ),
      );

      parent.slices = await Promise.all(
        parent.filteredQueryResult.map((file) =>
          this.executeSlice(
            parent,
            file.content,
            this.cache?.queryFileKey(parent, file),
            [file],
            parent.activeCacheMisses.has(file.content),
            signal,
          ),
        ),
      );
      parent.result = parent.slices.flatMap((s) => s.output);

      resolve();
      return parent.resultPromise;
    }

    if (QueryPipeline.is(parent) && parent.groupBy !== undefined) {
      const tagMap: Record<string, File[]> = {};
      for (const file of parent.filteredQueryResult) {
        (tagMap[parent.groupBy(file)] ??= []).push(file);
      }

      await Promise.all(
        parent.commands.map(
          (command) =>
            command.type === "pull" &&
            this.computeResult(command.pipeline, signal),
        ),
      );

      parent.slices = await Promise.all(
        Object.entries(tagMap).map(([tag, files]) =>
          this.executeSlice(
            parent,
            tag,
            this.cache?.queryGroupKey(parent, tag),
            files,
            files.some((f) => parent.activeCacheMisses.has(f.content)),
            signal,
          ),
        ),
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
        0,
        this.monolithicSnapshotPolicy(parent),
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
    onBeforePull?: (commandIndex: number, output: File[]) => void,
  ) {
    let output = inputs.slice();

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
          onBeforePull?.(i, output);

          let pulls = [command];

          let offset = 1;
          let nextCommand = parent.commands[i + offset];
          while (nextCommand && nextCommand.type === "pull") {
            pulls.push(nextCommand);
            offset++;
            nextCommand = parent.commands[i + offset];
          }
          i += offset - 1;

          let hostInput = output.slice();

          await Promise.all(
            pulls.map(async (pull) => {
              await this.computeResult(pull.pipeline, signal);

              if (!InteractivePipeline.is(pull.pipeline)) return;

              if (!pull.match) {
                output.push(...pull.pipeline.result);
                return;
              }

              for (const slice of this.sourceSlices(pull.pipeline)) {
                if (pull.match(slice.output, hostInput)) {
                  output.push(...slice.output);
                }
              }
            }),
          );
          break;
      }
    }

    return output;
  }

  private sourceSlices(pipeline: InteractivePipeline): Slice[] {
    if (
      (QueryPipeline.is(pipeline) || ClonePipeline.is(pipeline)) &&
      pipeline.slices !== undefined
    ) {
      return pipeline.slices;
    }
    return [{ key: "*", output: pipeline.result, dirty: !pipeline.cacheHit }];
  }

  private contributionsByPull(parent: InteractivePipeline, hostInput: File[]) {
    const out = new Map<number, { key: string; dirty: boolean }[]>();
    for (let i = 0; i < parent.commands.length; i++) {
      const command = parent.commands[i];
      if (command.type !== "pull") continue;
      if (!InteractivePipeline.is(command.pipeline)) continue;
      const contributions: { key: string; dirty: boolean }[] = [];
      for (const slice of this.sourceSlices(command.pipeline)) {
        if (command.match && !command.match(slice.output, hostInput)) continue;
        contributions.push({
          key: command.pipeline.id + ":" + slice.key,
          dirty: slice.dirty,
        });
      }
      out.set(i, contributions);
    }
    return out;
  }

  private monolithicSnapshotPolicy(parent: InteractivePipeline) {
    if (!this.cache) return undefined;
    const cache = this.cache;
    const baseKey = cache.pipelineKey(parent);
    return (i: number, output: File[]) => {
      cache.writeBeforePull(baseKey, i, output);
    };
  }

  // When trackFilesMembership is false, the caller is asserting that
  // filesDirty already fully captures input-side dirtiness (e.g. for clones,
  // the source slice's own dirty flag does this, and the slice's file
  // content paths can be unstable across runs).
  private async executeSlice(
    parent: InteractivePipeline,
    sliceKey: string,
    cacheKey: string | undefined,
    files: File[],
    filesDirty: boolean,
    signal: AbortSignal,
    trackFilesMembership: boolean = true,
  ): Promise<Slice> {
    const cache = this.cache;
    if (cache === undefined || cacheKey === undefined) {
      const output = await this.executeCommands(parent, files, signal);
      return { key: sliceKey, output, dirty: true };
    }

    let fileDirty = filesDirty;
    if (trackFilesMembership) {
      fileDirty ||= cache.filesMembershipChanged(cacheKey, files);
    }

    const contributionsByPull = this.contributionsByPull(parent, files);
    let firstDirtyPull: number | undefined = undefined;
    let groupStart: number | undefined = undefined;
    for (let i = 0; i < parent.commands.length; i++) {
      const command = parent.commands[i];
      if (command.type !== "pull") {
        groupStart = undefined;
        continue;
      }
      if (groupStart === undefined) groupStart = i;

      const contributions = contributionsByPull.get(i) ?? [];
      let pullDirty = contributions.some((c) => c.dirty);
      if (!pullDirty) {
        pullDirty = cache.pullMembershipChanged(
          cacheKey,
          i,
          contributions.map((c) => c.key),
        );
      }
      if (pullDirty && firstDirtyPull === undefined) {
        firstDirtyPull = groupStart;
      }
    }

    if (!fileDirty && firstDirtyPull === undefined) {
      const cached = cache.readResult(cacheKey);
      if (cached) return { key: sliceKey, output: cached, dirty: false };
    }

    let startIndex = 0;
    let input = files;
    if (!fileDirty && firstDirtyPull !== undefined && firstDirtyPull > 0) {
      const snapshot = cache.readBeforePull(cacheKey, firstDirtyPull);
      if (snapshot) {
        startIndex = firstDirtyPull;
        input = snapshot;
      }
    }

    const output = await this.executeCommands(
      parent,
      input,
      signal,
      startIndex,
      (i, output) => cache.writeBeforePull(cacheKey, i, output),
    );

    cache.writeResult(cacheKey, output);
    if (trackFilesMembership) cache.writeFilesMembership(cacheKey, files);
    for (const [i, contributions] of contributionsByPull) {
      cache.writePullMembership(
        cacheKey,
        i,
        contributions.map((c) => c.key),
      );
    }

    return {
      key: sliceKey,
      output,
      dirty: fileDirty || firstDirtyPull !== undefined,
    };
  }
}
