import type { Event } from "@parcel/watcher";
import { getEventsSince, writeSnapshot } from "@parcel/watcher";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { SetRequired } from "type-fest";

import type { Pipeline } from "../../pipelines";
import type { File } from "../../types";
import { collapsePaths, parseImportsDeep, shortHash } from "../../utils";
import type { AssetpipeOptions } from "../options";
import type { PipelineExecutorApi } from "./executor";

type AssetpipeCacheOptions = SetRequired<AssetpipeOptions, "cacheDirectory">;

export class PipelineCache {
  private resulsCacheBackup: Record<string, File[]> = {};
  private resulsCache: Record<string, File[]> = {};

  constructor(
    private executor: PipelineExecutorApi,
    private options: AssetpipeCacheOptions,
  ) {}

  public tempFilesPath!: string;
  public resultsPath!: string;
  public sourceCodeSnapshotsPath!: string;
  public inputsSnapshotsPath!: string;
  public inputFiles!: Set<string>;
  public inputDirectories!: string[];

  async init() {
    this.inputFiles = await parseImportsDeep(this.options.entry);
    this.inputDirectories = collapsePaths(this.inputFiles);

    const entryHash = shortHash(path.resolve(this.options.entry));
    this.resultsPath = path.join(
      this.options.cacheDirectory,
      "results",
      entryHash,
    );
    this.sourceCodeSnapshotsPath = path.join(
      this.options.cacheDirectory,
      "sourceCode",
    );
    this.inputsSnapshotsPath = path.join(this.options.cacheDirectory, "inputs");
    this.tempFilesPath = path.join(this.options.cacheDirectory, "temp");

    // await mkdir(this.options.cacheDirectory, { recursive: true });
    await mkdir(this.tempFilesPath, { recursive: true });
  }

  async loadResults() {
    try {
      this.resulsCacheBackup = JSON.parse(
        await readFile(this.resultsPath, "utf-8"),
      );
      this.resulsCache = structuredClone(this.resulsCacheBackup);

      let inputChanged = false;
      sourcesCheck: for (const directory of this.inputDirectories) {
        const snapshotPath = path.resolve(
          this.options.cacheDirectory,
          this.sourceCodeSnapshotsPath,
          shortHash(directory),
        );
        const events = await getEventsSince(directory, snapshotPath);

        for (const event of events) {
          if (this.inputFiles.has(event.path)) {
            inputChanged = true;
            break sourcesCheck;
          }
        }
      }

      if (inputChanged) {
        this.clear();
        await this.saveResults();
      }
    } catch {
      this.clear();
    }
  }

  loadBackup() {
    this.resulsCache = structuredClone(this.resulsCacheBackup);
  }

  async saveResults() {
    if (!this.resultsPath) return;
    await mkdir(path.dirname(this.resultsPath), { recursive: true });
    await writeFile(
      this.resultsPath,
      JSON.stringify(this.resulsCache),
      "utf-8",
    );
    this.resulsCacheBackup = structuredClone(this.resulsCache);
  }

  clear() {
    this.resulsCacheBackup = {};
    this.resulsCache = {};
  }

  async hitInputs() {
    const ignore: string[] = [];
    for (const pipeline of this.executor.ignorePipelines) {
      if (Array.isArray(pipeline.query)) {
        for (const query of pipeline.query) {
          ignore.push(path.join(pipeline.context, query).replace(/\\/g, "/"));
        }
      } else {
        ignore.push(
          path.join(pipeline.context, pipeline.query).replace(/\\/g, "/"),
        );
      }
    }

    const eventsPromises: Record<string, Promise<Event[]>> = {};

    await Promise.all(
      this.executor.queryPipelines.flatMap((pipeline) =>
        Object.keys(pipeline.states).map(async (query) => {
          const state = pipeline.states[query];
          const matcher = pipeline.matchers[query];
          const base = path.resolve(state.base);

          eventsPromises[base] ??= getEventsSince(
            base,
            path.join(pipeline.context, query),
            { ignore },
          );
          const events = await eventsPromises[base];

          for (const event of events) {
            const relativePath = path.relative(base, event.path);
            if (!matcher(relativePath) && !matcher(relativePath + path.sep)) {
              continue;
            }

            pipeline.cacheHit = true;
            return;
          }
        }),
      ),
    );
  }

  async snapshotInputs() {
    const ignore = [];
    for (const pipeline of this.executor.ignorePipelines) {
      if (Array.isArray(pipeline.query)) {
        for (const query of pipeline.query) {
          ignore.push(path.join(pipeline.context, query).replace(/\\/g, "/"));
        }
      } else {
        ignore.push(
          path.join(pipeline.context, pipeline.query).replace(/\\/g, "/"),
        );
      }
    }

    for (const pipeline of this.executor.queryPipelines) {
      for (const query in pipeline.states) {
        const state = pipeline.states[query];
        const base = path.resolve(state.base);

        await writeSnapshot(base, path.join(pipeline.context, query), {
          ignore,
        });
      }
    }
  }

  has(id: string): boolean {
    return this.resulsCache![id] !== undefined;
  }

  read(id: string): File[] | undefined {
    return this.resulsCache![id];
  }

  write(id: string, files: File[]) {
    this.resulsCache![id] = files;
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
