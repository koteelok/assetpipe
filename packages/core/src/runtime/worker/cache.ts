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
  public querySnapshotsPath!: string;
  public codeFiels!: Set<string>;
  public codeDirectories!: string[];

  async init() {
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
      this.resulsCacheBackup = JSON.parse(
        await readFile(this.resultsPath, "utf-8"),
      );
      this.resulsCache = structuredClone(this.resulsCacheBackup);

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

    for (const directory of this.codeDirectories) {
      const snapshotPath = path.join(
        this.sourceCodeSnapshotsPath,
        shortHash(directory),
      );

      await writeSnapshot(directory, snapshotPath);
    }
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
            this.querySnapshotsPath,
            shortHash(query),
          );

          if (!(await exists(base))) {
            throw new Error(
              `Failed query (${path.join(pipeline.context, query)}). Directory does not exist: ${base}`,
            );
          }

          eventsPromises[state.base] ??= (async () => {
            if (await exists(snapshotPath)) {
              const events = await getEventsSince(base, snapshotPath, { ignore });
              await writeSnapshot(base, snapshotPath, { ignore });
              return events;
            } else {
              await writeSnapshot(base, snapshotPath, { ignore });
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

          for (const event of events) {
            const relativePath = path.relative(base, event.path);
            if (!matcher(relativePath) && !matcher(relativePath + path.sep)) {
              continue;
            }

            pipeline.cacheHit = false;
            pipeline.cacheMisses.add(event.path);
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
