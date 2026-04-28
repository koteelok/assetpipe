import ParcelWatcher, { getEventsSince, writeSnapshot } from "@parcel/watcher";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import type { SetRequired } from "type-fest";

import {
  GroupPipeline,
  InteractivePipeline,
  type Pipeline,
  QueryPipeline,
} from "../../pipelines";
import type { File } from "../../types";
import {
  cloneFiles,
  collapsePaths,
  exists,
  existsFile,
  parseImportsDeep,
  shortHash,
} from "../../utils";
import type { ExecutionMetadata } from "../options";
import type { PipelineState } from "./state";
import { AssetpipeOptionsWithDefaults } from "../options";

type AssetpipeCacheOptions = SetRequired<
  AssetpipeOptionsWithDefaults,
  "cacheDirectory"
>;

class ExecutionCache {
  results: Record<string, File[]> = {};
  output: File[] = [];

  extract(reference: any) {
    this.results = reference.results;
    this.output = reference.output;
  }

  copy(reference: ExecutionCache) {
    this.results = {};
    for (const id in reference.results) {
      this.results[id] = cloneFiles(reference.results[id]);
    }
    this.output = reference.output.slice();
  }

  clear() {
    this.results = {};
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
  public codeFiels!: Set<string>;
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

    this.codeFiels = await parseImportsDeep(this.options.entry);
    this.codeDirectories = collapsePaths(this.codeFiels);

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
      this.resulsCacheBackup.extract(
        JSON.parse(await readFile(this.resultsPath, "utf-8")),
      );
      this.resulsCache.clear();

      let codeChanged = false;
      for (const directory of this.codeDirectories) {
        const snapshotPath = path.join(
          this.sourceCodeSnapshotsPath,
          shortHash(directory),
        );

        const snapshotExists = await exists(snapshotPath);

        if (snapshotExists) {
          const events = await getEventsSince(directory, snapshotPath);

          for (const event of events) {
            if (this.codeFiels.has(event.path)) {
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

    for (const directory of this.codeDirectories) {
      const snapshotPath = path.join(
        this.sourceCodeSnapshotsPath,
        shortHash(directory),
      );

      await writeSnapshot(directory, snapshotPath);
    }

    const writePromises: Record<string, Promise<string>> = {};

    await Promise.all(
      this.state.queryPipelines.flatMap((pipeline) =>
        Object.keys(pipeline.states).map(async (query) => {
          const state = pipeline.states[query];
          const base = path.resolve(this.options.queryBase, state.base);
          const snapshotPath = path.join(
            this.querySnapshotsPath,
            shortHash(query),
          );

          if (!(await exists(base))) {
            throw new Error(
              `Failed query (${path.join(pipeline.context, query)}). Directory does not exist: ${base}`,
            );
          }

          writePromises[state.base] ??= writeSnapshot(base, snapshotPath, {
            ignore: this.state.ignorePatterns,
          });
        }),
      ),
    );
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

          if (state.glob === "") {
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
                return getEventsSince(fileDirname, snapshotPath, {
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
              const relativePath = path.relative(fileDirname, event.path);

              if (relativePath !== fileBasename) {
                continue;
              }

              pipeline.cacheHit = false;
              pipeline.cacheMisses.add(event.path);
            }
          } else {
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
                return getEventsSince(basePath, snapshotPath, {
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
              if (!matcher(relativePath) && !matcher(relativePath + path.sep)) {
                continue;
              }

              pipeline.cacheHit = false;
              pipeline.cacheMisses.add(event.path);
            }
          }
        }),
      ),
    );
  }

  async waterfallCacheHits(parent: Pipeline) {
    if (GroupPipeline.is(parent)) {
      parent.cacheHit = true;

      for (const child of parent.children) {
        this.waterfallCacheHits(child);

        if (InteractivePipeline.is(child) && !child.cacheHit) {
          parent.cacheHit = false;
          break;
        }
      }
    }

    if (QueryPipeline.is(parent)) {
      parent.cacheHit = parent.cacheHit || parent.cacheMisses.size === 0;
    }

    if (InteractivePipeline.is(parent)) {
      parent.firstDirtyPull = undefined;

      for (let i = 0; i < parent.commands.length; i++) {
        const command = parent.commands[i];
        if (command.type === "pull") {
          this.waterfallCacheHits(command.pipeline);

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
      const prevFilePath = path.join(prevFile.dirname, prevFile.basename);
      prevOutputMap[prevFilePath] = prevFile;
    }

    for (let i = 0; i < curOutput.length; i++) {
      const curFile = curOutput[i];
      const curFilePath = path.join(curFile.dirname, curFile.basename);
      curOutputMap[curFilePath] = curFile;

      const prevFile = prevOutputMap[curFilePath];

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
      const prevFilePath = path.join(prevFile.dirname, prevFile.basename);

      if (!curOutputMap[prevFilePath]) {
        removedFiles.push(prevFile);
      }
    }

    const queryTriggers = [];
    for (let i = 0; i < this.state.queryPipelines.length; i++) {
      const queryPipeline = this.state.queryPipelines[i];
      if (!queryPipeline.cacheHit) {
        const cacheMisses = Array.from(queryPipeline.cacheMisses);
        for (let j = 0; j < cacheMisses.length; j++) {
          queryTriggers.push(cacheMisses[j]);
        }
      }
    }

    return { addedFiles, changedFiles, removedFiles, queryTriggers };
  }

  writeOutput(files: File[]) {
    this.resulsCache.output = files;
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

  writeResult(id: string, files: File[]) {
    this.resulsCache.results[id] = files;
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
}
