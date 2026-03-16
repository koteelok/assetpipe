import type { Event } from "@parcel/watcher";
import { getEventsSince, writeSnapshot } from "@parcel/watcher";
import { mkdir, readFile, writeFile } from "fs/promises";
import path, { dirname } from "path";
import type { SetRequired } from "type-fest";

import {
  GroupPipeline,
  InteractivePipeline,
  type Pipeline,
  QueryPipeline,
} from "../../pipelines";
import type { File } from "../../types";
import { collapsePaths, parseImportsDeep, shortHash } from "../../utils";
import { exists } from "../../utils/exists";
import type { AssetpipeOptions } from "../options";
import type { PipelineState } from "./state";

type AssetpipeCacheOptions = SetRequired<AssetpipeOptions, "cacheDirectory">;

export class PipelineCache {
  private resulsCacheBackup: Record<string, File[]> = {};
  private resulsCache: Record<string, File[]> = {};

  constructor(
    private state: PipelineState,
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

    await mkdir(this.sourceCodeSnapshotsPath, { recursive: true });
    await mkdir(this.inputsSnapshotsPath, { recursive: true });
    await mkdir(this.tempFilesPath, { recursive: true });
  }

  async loadResults() {
    try {
      this.resulsCacheBackup = JSON.parse(
        await readFile(this.resultsPath, "utf-8"),
      );
      this.resulsCache = structuredClone(this.resulsCacheBackup);

      let inputChanged = false;
      for (const directory of this.inputDirectories) {
        const snapshotPath = path.join(
          this.sourceCodeSnapshotsPath,
          shortHash(directory),
        );

        const snapshotExists = await exists(snapshotPath);

        if (snapshotExists) {
          const events = await getEventsSince(directory, snapshotPath);

          for (const event of events) {
            if (this.inputFiles.has(event.path)) {
              inputChanged = true;
              break;
            }
          }
        } else {
          await writeSnapshot(directory, snapshotPath);
          inputChanged = true;
          break;
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

  restoreFromBackup() {
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

  async hitQueries() {
    const ignore: string[] = [];
    for (const pipeline of this.state.ignorePipelines) {
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

    const eventsPromises: Record<string, Promise<Event[] | undefined>> = {};

    await Promise.all(
      this.state.queryPipelines.flatMap((pipeline) =>
        Object.keys(pipeline.states).map(async (query) => {
          const state = pipeline.states[query];
          const matcher = pipeline.matchers[query];
          const base = path.resolve(dirname(this.options.entry), state.base);
          const snapshotPath = path.join(
            this.inputsSnapshotsPath,
            shortHash(query),
          );

          eventsPromises[state.base] ??= (async () => {
            if (await exists(snapshotPath)) {
              return getEventsSince(base, snapshotPath, { ignore });
            } else {
              await writeSnapshot(base, snapshotPath, { ignore });
            }
          })();

          const events = await eventsPromises[state.base];

          if (!events) {
            pipeline.cacheHit = true;
            return;
          }

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

  async computeCacheHits(parent: Pipeline) {
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
      parent.cacheHit = parent.cacheHit || parent.cacheMisses.size === 0;
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
