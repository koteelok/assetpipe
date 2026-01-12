import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { getEventsSince } from "@parcel/watcher";

import { File } from "../types";
import { shortHash, collapsePaths } from "../utils";

export class PipelineCache {
  private snapshotCache: Record<string, File[]> = {};
  private workingCache: Record<string, File[]> = {};
  public resultsPath?: string;

  constructor(
    private entry: string,
    private sourceFiles: Set<string>,
    private cacheDirectory: string
  ) {}

  async load() {
    try {
      await mkdir(this.cacheDirectory, { recursive: true });

      const entryHash = shortHash(path.resolve(this.entry));
      this.resultsPath = path.join(this.cacheDirectory, "results", entryHash);

      this.snapshotCache = JSON.parse(
        await readFile(this.resultsPath, "utf-8")
      );
      this.workingCache = structuredClone(this.snapshotCache);

      const sourceDirectories = collapsePaths(this.sourceFiles);

      let sourcesChanged = false;
      sourcesCheck: for (const directory of sourceDirectories) {
        const snapshotPath = path.resolve(
          this.cacheDirectory,
          "snapshots",
          shortHash(directory)
        );
        const events = await getEventsSince(directory, snapshotPath);

        for (const event of events) {
          if (this.sourceFiles.has(event.path)) {
            sourcesChanged = true;
            break sourcesCheck;
          }
        }
      }

      if (sourcesChanged) {
        this.snapshotCache = {};
        this.workingCache = {};
        await this.save();
      }
    } catch {
      this.snapshotCache = {};
      this.workingCache = {};
    }
  }

  async save() {
    if (!this.resultsPath) return;
    await mkdir(path.dirname(this.resultsPath), { recursive: true });
    await writeFile(
      this.resultsPath,
      JSON.stringify(this.workingCache),
      "utf-8"
    );
    this.snapshotCache = structuredClone(this.workingCache);
  }

  clear() {
    this.snapshotCache = {};
    this.workingCache = {};
  }

  reset() {
    this.workingCache = structuredClone(this.snapshotCache);
  }

  has(id: string): boolean {
    return this.workingCache![id] !== undefined;
  }

  read(id: string): File[] {
    return this.workingCache![id];
  }

  write(id: string, files: File[]) {
    this.workingCache![id] = files;
  }
}
