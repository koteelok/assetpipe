import type { AsyncSubscription } from "@parcel/watcher";
import { subscribe } from "@parcel/watcher";
import { randomUUID } from "crypto";
import { copyFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path, { dirname } from "path";
import picomatch from "picomatch";

import type { File } from "../types";
import { collapsePaths, debounceAsync, parseImportsDeep } from "../utils";
import { exists } from "../utils/exists";
import { createExecutor, type PipelineExecutorAPI } from "./executor";
import type { AssetpipeOptions } from "./options";
import type { SerializedExecutorState } from "./worker";

type AssetpipeWatcherOptions = AssetpipeOptions & {
  onOutput?: (files: File[]) => void;
};

export class PipelineWatcher {
  constructor(private options: AssetpipeWatcherOptions) {}

  private active = false;

  async spawn() {
    if (this.active) return;
    this.active = true;

    this.onSourceCodeChange.enable();

    const { executor, state } = await createExecutor(this.options);
    this.executor = executor;
    this.state = state;

    if (this.options.cacheDirectory) {
      const cacheTempDirectory = await this.executor.cacheTempDirectory();
      if (!cacheTempDirectory) {
        throw new Error(
          "Failed to acquire cache temp directory from PipelineExecutorAPI",
        );
      }
      this.tempDirectory = cacheTempDirectory;
    } else {
      this.tempDirectory = `${tmpdir()}/${randomUUID()}`;
      await mkdir(this.tempDirectory, { recursive: true });
    }

    if (this.options.outputDirectory) {
      await mkdir(this.options.outputDirectory, { recursive: true });
    }

    if (this.options.cacheDirectory) {
      await this.executor.hitQueriesAgainstCache();
      await this.executor.loadResultsFromCache();
    }
    await this.executor.executeAllQueries();

    await this.subscribeToSourceCode();
    await this.subscribeToQueries();
    await this.run();

    this.onQueryTriggered.enable();
  }

  async despawn() {
    if (!this.active) return;
    this.active = false;
    await Promise.all([
      (async () => {
        if (!this.options.cacheDirectory) {
          await rm(this.tempDirectory, { recursive: true });
        }
      })(),
      this.onQueryTriggered.disable(),
      this.unsubscribeFromSourceCode(),
      this.unsubscribeFromQueries(),
    ]);
  }

  private tempDirectory!: string;
  private executor!: PipelineExecutorAPI;
  private state!: SerializedExecutorState;
  private sourceCodeSubscriptions?: AsyncSubscription[];

  private async subscribeToSourceCode() {
    const codeFiles = await parseImportsDeep(this.options.entry);
    const codeDirectories = collapsePaths(codeFiles);

    const subscriptions = [];
    for (const directory of codeDirectories) {
      subscriptions.push(
        subscribe(directory, (errs, events) => {
          for (const event of events) {
            if (codeFiles.has(event.path)) {
              this.onSourceCodeChange.call();
              break;
            }
          }
        }),
      );
    }

    this.sourceCodeSubscriptions = await Promise.all(subscriptions);
  }

  private async unsubscribeFromSourceCode() {
    if (this.sourceCodeSubscriptions) {
      const unsubscriptions = [];
      for (const subscription of this.sourceCodeSubscriptions) {
        unsubscriptions.push(subscription.unsubscribe());
      }
      this.sourceCodeSubscriptions = [];
      await Promise.all(unsubscriptions);
    }
  }

  private onSourceCodeChange = debounceAsync(async () => {
    await this.despawn();
    await this.spawn();
  }, 100);

  private querySubscriptions?: AsyncSubscription[];

  private async subscribeToQueries() {
    const subscriptions = [];
    const subscriptionOptions = { ignore: this.state.ignorePatterns };
    const pendingSubmissions = new Set<Promise<void>>();

    for (
      let pipelineIndex = 0;
      pipelineIndex < this.state.queryPipelines.length;
      pipelineIndex++
    ) {
      const info = this.state.queryPipelines[pipelineIndex];

      for (let queryIndex = 0; queryIndex < info.query.length; queryIndex++) {
        const query = info.query[queryIndex];
        const state = info.states[info.query[queryIndex]];
        const basePath = path.resolve(dirname(this.options.entry), state.base);
        const matcher = picomatch(state.glob, {
          windows: process.platform === "win32",
        });

        if (!(await exists(basePath))) {
          console.warn(
            `Failed query (${path.join(info.context, query)}). Directory does not exist: ${basePath}`,
          );
        }

        subscriptions.push(
          subscribe(
            basePath,
            (err, events) => {
              for (const event of events) {
                const relativePath = path.relative(basePath, event.path);
                if (
                  !matcher(relativePath) &&
                  !matcher(relativePath + path.sep)
                ) {
                  continue;
                }

                const promise = this.executor
                  .submitQueryCacheMiss(
                    pipelineIndex,
                    queryIndex,
                    event.type,
                    event.path,
                  )
                  .then(() => {
                    pendingSubmissions.delete(promise);

                    if (pendingSubmissions.size === 0) {
                      this.onQueryTriggered.call();
                    }
                  });
                pendingSubmissions.add(promise);
              }
            },
            subscriptionOptions,
          ),
        );
      }
    }

    this.querySubscriptions = await Promise.all(subscriptions);
  }

  private onQueryTriggered = debounceAsync(async () => {
    await this.run();
  }, 100);

  private async unsubscribeFromQueries() {
    if (this.querySubscriptions) {
      const unsubscriptions = [];
      for (const subscription of this.querySubscriptions) {
        unsubscriptions.push(subscription.unsubscribe());
      }
      this.querySubscriptions = [];
      await Promise.all(unsubscriptions);
    }
  }

  private lastRun: Promise<void> = Promise.resolve();

  private async run() {
    await this.executor.abort();

    const previousRun = this.lastRun;

    this.lastRun = (async () => {
      try {
        await previousRun;
      } catch {}

      try {
        const files = await this.executor.computePipelineResults(
          this.tempDirectory,
        );

        if (this.options.cacheDirectory) {
          await this.executor.saveResultsToCache();
        }

        if (files) {
          if (this.options.outputDirectory) {
            await Promise.all(
              files.map((file) =>
                copyFile(
                  file.content,
                  `${this.options.outputDirectory}/${file.basename}`,
                ),
              ),
            );
          }

          this.options.onOutput?.(files);
        }
      } catch (error) {
        if (this.options.cacheDirectory) {
          await this.executor.restoreCacheFromBackup();
        }

        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        throw error;
      }
    })();

    await this.lastRun;
  }
}

export async function watch(options: AssetpipeWatcherOptions) {
  if (!options.outputDirectory && !options.onOutput) {
    throw new Error("Either outputDirectory or onOutput must be provided");
  }

  return new PipelineWatcher(options);
}
