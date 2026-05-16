import ParcelWatcher from "@parcel/watcher";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import type { SetRequired } from "type-fest";

import {
  GroupPipeline,
  InteractivePipeline,
  type Pipeline,
  QueryPipeline,
} from "../../pipelines";
import { File } from "../../types";
import {
  collapsePaths,
  exists,
  existsFile,
  parseImportsDeep,
  shortHash,
} from "../../utils";
import type { ExecutionMetadata } from "../options";
import type { PipelineState } from "./state";
import { AssetpipeOptionsWithDefaults } from "../options";

export type AssetpipeCacheOptions = SetRequired<
  AssetpipeOptionsWithDefaults,
  "cacheDirectory"
>;

class ExecutionCache {
  results: Record<string, File[]> = {};
  groupMembership: Record<string, string[]> = {};
  output: File[] = [];

  extract(reference: any) {
    this.results = reference.results;
    this.groupMembership = reference.groupMembership ?? {};
    this.output = reference.output;
  }

  copy(reference: ExecutionCache) {
    this.results = {};
    for (const id in reference.results) {
      this.results[id] = reference.results[id].slice();
    }
    this.groupMembership = {};
    for (const id in reference.groupMembership) {
      this.groupMembership[id] = reference.groupMembership[id].slice();
    }
    this.output = reference.output.slice();
  }

  clear() {
    this.results = {};
    this.groupMembership = {};
    this.output = [];
  }
}

export class PipelineCacheManager {
  private CACHE_VERSION = 1;
  private resulsCacheBackup = new ExecutionCache();
  private resulsCache = new ExecutionCache();
  private invalidated = false;

  constructor(
    private state: PipelineState,
    private options: AssetpipeCacheOptions,
  ) {}

  public tempFilesPath!: string;
  public resultsPath!: string;
  public sourceCodeSnapshotsPath!: string;
  public querySnapshotsPath!: string;
  public codeFiles!: Set<string>;
  public codeDirectories!: string[];

  async init() {
    const versionFile = path.join(this.options.cacheDirectory, "version");

    const storedVersion = await existsFile(versionFile).then(
      (exists) => (exists ? readFile(versionFile, "utf-8").then(parseInt) : -1),
      () => -1,
    );
    if (storedVersion !== this.CACHE_VERSION) {
      await rm(this.options.cacheDirectory, { recursive: true, force: true });
      await mkdir(this.options.cacheDirectory, { recursive: true });
      await writeFile(versionFile, this.CACHE_VERSION.toString());
    }

    this.codeFiles = await parseImportsDeep(this.options.entry);
    this.codeDirectories = collapsePaths(this.codeFiles);

    const entryPath = path.join(
      this.options.cacheDirectory,
      shortHash(path.resolve(this.options.entry)),
    );

    this.resultsPath = path.join(entryPath, "results");
    this.sourceCodeSnapshotsPath = path.join(entryPath, "sourceCode");
    this.querySnapshotsPath = path.join(entryPath, "queries");
    this.tempFilesPath = path.join(entryPath, "temp");

    await mkdir(this.sourceCodeSnapshotsPath, { recursive: true });
    await mkdir(this.querySnapshotsPath, { recursive: true });
    await mkdir(this.tempFilesPath, { recursive: true });
  }

  async loadResults() {
    try {
      const parsed = JSON.parse(await readFile(this.resultsPath, "utf-8"));
      for (const id in parsed.results) {
        parsed.results[id] = parsed.results[id].map(
          (f: { target: string; content: string }) =>
            new File(f.target, f.content),
        );
      }
      parsed.output = parsed.output.map(
        (f: { target: string; content: string }) =>
          new File(f.target, f.content),
      );
      this.resulsCacheBackup.extract(parsed);

      let codeChanged = false;
      for (const directory of this.codeDirectories) {
        const snapshotPath = path.join(
          this.sourceCodeSnapshotsPath,
          shortHash(directory),
        );

        const snapshotExists = await exists(snapshotPath);

        if (snapshotExists) {
          const events = await ParcelWatcher.getEventsSince(
            directory,
            snapshotPath,
          );

          for (const event of events) {
            if (this.codeFiles.has(event.path)) {
              codeChanged = true;
              break;
            }
          }
        } else {
          codeChanged = true;
          break;
        }
      }

      if (codeChanged) {
        this.invalidated = true;
        this.resulsCache.clear();
      } else {
        this.resulsCache.copy(this.resulsCacheBackup);
      }
    } catch {
      this.invalidated = true;
      this.clear();
    }
  }

  restoreFromBackup() {
    this.resulsCache.copy(this.resulsCacheBackup);
    this.invalidated = false;
  }

  async saveResults() {
    if (!this.resultsPath) return;

    await mkdir(path.dirname(this.resultsPath), { recursive: true });
    await writeFile(
      this.resultsPath,
      JSON.stringify(this.resulsCache),
      "utf-8",
    );
    this.resulsCacheBackup.copy(this.resulsCache);

    for (let i = 0; i < this.codeDirectories.length; i++) {
      const directory = this.codeDirectories[i];
      const snapshotPath = path.join(
        this.sourceCodeSnapshotsPath,
        shortHash(directory),
      );
      await ParcelWatcher.writeSnapshot(directory, snapshotPath);
    }

    const writePromises: Record<string, Promise<string>> = {};

    for (let i = 0; i < this.state.queryPipelines.length; i++) {
      const pipeline = this.state.queryPipelines[i];
      for (const query in pipeline.states) {
        const state = pipeline.states[query];
        const snapshotPath = path.join(
          this.querySnapshotsPath,
          shortHash(query),
        );

        switch (state.kind) {
          case "file": {
            const filePath = path.resolve(this.options.queryBase, state.base);
            const fileDirname = path.dirname(filePath);

            if (!(await existsFile(filePath))) {
              console.warn(
                `Failed query (${path.join(pipeline.context, query)}). File does not exist: ${filePath}`,
              );
            }

            writePromises[state.base] ??= ParcelWatcher.writeSnapshot(
              fileDirname,
              snapshotPath,
              {
                ignore: this.state.ignorePatterns,
              },
            );
            break;
          }

          case "glob": {
            const base = path.resolve(this.options.queryBase, state.base);

            if (!(await exists(base))) {
              throw new Error(
                `Failed query (${path.join(pipeline.context, query)}). Directory does not exist: ${base}`,
              );
            }

            writePromises[state.base] ??= ParcelWatcher.writeSnapshot(
              base,
              snapshotPath,
              {
                ignore: this.state.ignorePatterns,
              },
            );
            break;
          }
        }
      }
    }

    await Promise.all(Object.values(writePromises));
  }

  clear() {
    this.resulsCacheBackup.clear();
    this.resulsCache.clear();
  }

  async hitQueries() {
    const eventsPromises: Record<
      string,
      Promise<ParcelWatcher.Event[] | undefined>
    > = {};

    await Promise.all(
      this.state.queryPipelines.flatMap((pipeline) =>
        Object.keys(pipeline.states).map(async (query) => {
          const state = pipeline.states[query];
          const snapshotPath = path.join(
            this.querySnapshotsPath,
            shortHash(query),
          );

          switch (state.kind) {
            case "file": {
              const filePath = path.resolve(this.options.queryBase, state.base);
              const fileDirname = path.dirname(filePath);
              const fileBasename = path.basename(filePath);

              if (!(await existsFile(filePath))) {
                console.warn(
                  `Failed query (${path.join(pipeline.context, query)}). File does not exist: ${filePath}`,
                );
              }

              eventsPromises[state.base] ??= (async () => {
                if (await exists(snapshotPath)) {
                  return ParcelWatcher.getEventsSince(
                    fileDirname,
                    snapshotPath,
                    {
                      ignore: this.state.ignorePatterns,
                    },
                  );
                }
              })();

              const events = await eventsPromises[state.base];

              if (!events) {
                pipeline.cacheHit = false;
                return;
              }

              if (events.length === 0) {
                pipeline.cacheHit = true;
                return;
              }

              for (let i = 0; i < events.length; i++) {
                const event = events[i];
                const relativePath = path.relative(fileDirname, event.path);

                if (relativePath !== fileBasename) {
                  continue;
                }

                pipeline.cacheHit = false;
                pipeline.pendingCacheMisses.add(event.path);
              }
              break;
            }

            case "glob": {
              const matcher = pipeline.matchers[query];
              const basePath = path.resolve(
                this.options.queryBase ? this.options.queryBase : "",
                state.base,
              );

              if (!(await exists(basePath))) {
                throw new Error(
                  `Failed query (${path.join(pipeline.context, query)}). Directory does not exist: ${basePath}`,
                );
              }

              eventsPromises[state.base] ??= (async () => {
                if (await exists(snapshotPath)) {
                  return ParcelWatcher.getEventsSince(basePath, snapshotPath, {
                    ignore: this.state.ignorePatterns,
                  });
                }
              })();

              const events = await eventsPromises[state.base];

              if (!events) {
                pipeline.cacheHit = false;
                return;
              }

              if (events.length === 0) {
                pipeline.cacheHit = true;
                return;
              }

              for (let i = 0; i < events.length; i++) {
                const event = events[i];
                const relativePath = path.relative(basePath, event.path);
                if (
                  !matcher(relativePath) &&
                  !matcher(relativePath + path.sep)
                ) {
                  continue;
                }

                pipeline.cacheHit = false;
                pipeline.pendingCacheMisses.add(event.path);
              }
              break;
            }
          }
        }),
      ),
    );
  }

  drainPendingCacheMisses() {
    for (const pipeline of this.state.queryPipelines) {
      for (const miss of pipeline.pendingCacheMisses) {
        pipeline.activeCacheMisses.add(miss);
      }
      pipeline.pendingCacheMisses.clear();
    }
  }

  drainActiveCacheMisses() {
    for (const pipeline of this.state.queryPipelines) {
      pipeline.activeCacheMisses.clear();
    }
  }

  async waterfallCacheHits(parent: Pipeline) {
    if (GroupPipeline.is(parent)) {
      if (parent.source) {
        this.waterfallCacheHits(parent.source);
        parent.cacheHit = true;
        if (
          InteractivePipeline.is(parent.source) &&
          (!parent.source.cacheHit ||
            parent.source.firstDirtyPull !== undefined)
        ) {
          parent.cacheHit = false;
        }
      } else {
        parent.cacheHit = true;

        for (const child of parent.children) {
          this.waterfallCacheHits(child);

          if (
            InteractivePipeline.is(child) &&
            (!child.cacheHit || child.firstDirtyPull !== undefined)
          ) {
            parent.cacheHit = false;
          }
        }
      }
    }

    if (QueryPipeline.is(parent)) {
      if (parent.source) {
        this.waterfallCacheHits(parent.source);
        parent.cacheHit = true;
        if (
          InteractivePipeline.is(parent.source) &&
          (!parent.source.cacheHit ||
            parent.source.firstDirtyPull !== undefined)
        ) {
          parent.cacheHit = false;
        }
      } else {
        parent.cacheHit =
          parent.cacheHit || parent.activeCacheMisses.size === 0;
      }
    }

    if (InteractivePipeline.is(parent)) {
      parent.firstDirtyPull = undefined;

      for (let i = 0; i < parent.commands.length; i++) {
        const command = parent.commands[i];
        if (command.type === "pull") {
          this.waterfallCacheHits(command.pipeline);

          if (
            InteractivePipeline.is(command.pipeline) &&
            (!command.pipeline.cacheHit ||
              command.pipeline.firstDirtyPull !== undefined)
          ) {
            if (parent.firstDirtyPull === undefined) {
              parent.firstDirtyPull = i;
            }
          }
        }
      }
    }
  }

  getRedundantTempFiles() {
    const curTempFiles = new Set<string>();
    for (const files of Object.values(this.resulsCache.results)) {
      for (const file of files) {
        if (file.content.startsWith(this.tempFilesPath)) {
          curTempFiles.add(file.content);
        }
      }
    }

    const removedTempFiles = new Set<string>();
    for (const files of Object.values(this.resulsCacheBackup.results)) {
      for (const file of files) {
        if (
          file.content.startsWith(this.tempFilesPath) &&
          !curTempFiles.has(file.content)
        ) {
          removedTempFiles.add(file.content);
        }
      }
    }

    return Array.from(removedTempFiles);
  }

  getExecutionMetadata(): ExecutionMetadata {
    const prevOutput = this.resulsCacheBackup.output;
    const curOutput = this.resulsCache.output;

    const addedFiles = [] as File[];
    const changedFiles = [] as File[];
    const removedFiles = [] as File[];

    const prevOutputMap = {} as Record<string, File | undefined>;
    const curOutputMap = {} as Record<string, File | undefined>;

    for (let i = 0; i < prevOutput.length; i++) {
      const prevFile = prevOutput[i];
      prevOutputMap[prevFile.target] = prevFile;
    }

    for (let i = 0; i < curOutput.length; i++) {
      const curFile = curOutput[i];
      curOutputMap[curFile.target] = curFile;

      const prevFile = prevOutputMap[curFile.target];

      if (!prevFile) {
        addedFiles.push(curFile);
        continue;
      }

      if (curFile.content !== prevFile.content) {
        changedFiles.push(curFile);
      }
    }

    for (let i = 0; i < prevOutput.length; i++) {
      const prevFile = prevOutput[i];

      if (!curOutputMap[prevFile.target]) {
        removedFiles.push(prevFile);
      }
    }

    const queryTriggers = [];
    for (let i = 0; i < this.state.queryPipelines.length; i++) {
      const queryPipeline = this.state.queryPipelines[i];
      if (!queryPipeline.cacheHit) {
        const activeCacheMisses = Array.from(queryPipeline.activeCacheMisses);
        for (let j = 0; j < activeCacheMisses.length; j++) {
          queryTriggers.push(activeCacheMisses[j]);
        }
      }
    }

    return { addedFiles, changedFiles, removedFiles, queryTriggers };
  }

  writeOutput(files: readonly File[]) {
    this.resulsCache.output = files.slice();
  }

  hasResult(id: string): boolean {
    if (this.resulsCache.results[id] !== undefined) return true;
    if (!this.invalidated && this.resulsCacheBackup.results[id] !== undefined)
      return true;
    return false;
  }

  readResult(id: string): File[] | undefined {
    if (this.resulsCache.results[id]) return this.resulsCache.results[id];
    if (!this.invalidated && this.resulsCacheBackup.results[id]) {
      this.resulsCache.results[id] = this.resulsCacheBackup.results[id];
      return this.resulsCache.results[id];
    }
    return undefined;
  }

  writeResult(id: string, files: readonly File[]) {
    this.resulsCache.results[id] = files.slice();
  }

  readGroupMembership(id: string): Set<string> | undefined {
    const live = this.resulsCache.groupMembership[id];
    if (live) return new Set(live);
    if (!this.invalidated) {
      const backup = this.resulsCacheBackup.groupMembership[id];
      if (backup) {
        this.resulsCache.groupMembership[id] = backup.slice();
        return new Set(backup);
      }
    }
    return undefined;
  }

  writeGroupMembership(id: string, members: Set<string>) {
    this.resulsCache.groupMembership[id] = Array.from(members);
  }

  pipelineKey(pipeline: Pipeline) {
    return pipeline.id.toString();
  }

  beforePullKey(pipeline: Pipeline, commandIndex: number) {
    return pipeline.id + "#" + commandIndex;
  }

  queryGroupKey(pipeline: Pipeline, tag: string) {
    return pipeline.id + "@" + tag;
  }

  queryFileKey(pipeline: Pipeline, file: File) {
    return pipeline.id + "$" + file.content;
  }

  cloneSliceKey(pipeline: Pipeline, sliceKey: string) {
    return pipeline.id + "%" + sliceKey;
  }

  beforePullSliceKey(
    pipeline: Pipeline,
    commandIndex: number,
    sliceKey: string,
  ) {
    return pipeline.id + "#" + commandIndex + "@" + sliceKey;
  }
}
