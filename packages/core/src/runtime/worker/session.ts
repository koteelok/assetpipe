import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter.js";
import { randomUUID } from "crypto";
import { copyFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { parentPort } from "worker_threads";

import type { File } from "../../types";
import type {
  AssetpipeOptionsWithDefaults,
  ExecutionMetadata,
} from "../options";
import { PipelineExecutor } from "./executor";
import { PipelineWatchSession, type WatchCallbacks } from "./watch";

export interface CycleResult {
  files?: File[];
  metadata?: ExecutionMetadata;
}

export class PipelineSession {
  public readonly executor = new PipelineExecutor();
  public options!: AssetpipeOptionsWithDefaults;
  private tempDirectory!: string;
  private ownsTempDirectory = false;
  private watch?: PipelineWatchSession;

  async init(options: AssetpipeOptionsWithDefaults): Promise<void> {
    this.options = options;
    await this.executor.init(options);

    if (options.cacheDirectory) {
      this.tempDirectory = this.executor.cache!.tempFilesPath;
    } else {
      this.tempDirectory = path.join(tmpdir(), randomUUID());
      await mkdir(this.tempDirectory, { recursive: true });
      this.ownsTempDirectory = true;
    }

    if (options.outputDirectory) {
      await mkdir(options.outputDirectory, { recursive: true });
    }

    if (this.executor.cache) {
      await this.executor.cache.hitQueries();
      await this.executor.cache.loadResults();
    }
    await this.executor.executeAllQueries();
  }

  async runWatch(callbacks: WatchCallbacks): Promise<void> {
    this.watch = new PipelineWatchSession(this, callbacks);
    await this.watch.start();
  }

  async dispose(): Promise<void> {
    await this.watch?.stop();
    this.watch = undefined;
    if (this.ownsTempDirectory) {
      await rm(this.tempDirectory, { recursive: true, force: true });
    }
  }

  async runCycle(): Promise<CycleResult> {
    const { cache } = this.executor;
    const { outputDirectory, cacheDirectory } = this.options;

    try {
      const files = await this.executor.computePipelineOutput(
        this.tempDirectory,
      );

      let metadata: ExecutionMetadata | undefined;

      if (cache) {
        const redundant = cache.getRedundantTempFiles();
        await Promise.all(
          redundant.map((f) => rm(f, { recursive: true, force: true })),
        );

        metadata = cache.getExecutionMetadata();

        if (metadata && outputDirectory) {
          await Promise.all(
            metadata.removedFiles.map((file) =>
              rm(path.join(outputDirectory, file.target), {
                recursive: true,
                force: true,
              }),
            ),
          );
        }
      } else if (outputDirectory) {
        await rm(outputDirectory, { recursive: true, force: true });
        await mkdir(outputDirectory, { recursive: true });
      }

      if (files && outputDirectory) {
        await Promise.all(
          files.map(async (file) => {
            await mkdir(path.join(outputDirectory, file.dirname), {
              recursive: true,
            });
            await copyFile(
              file.content,
              path.join(outputDirectory, file.target),
            );
          }),
        );
      }

      if (cacheDirectory && cache) {
        await cache.saveResults();
        cache.drainActiveCacheMisses();
      }

      return { files, metadata };
    } catch (err) {
      if (cache) cache.restoreFromBackup();
      throw err;
    }
  }
}

if (parentPort) {
  comlink.expose(new PipelineSession(), nodeEndpoint(parentPort));
}
