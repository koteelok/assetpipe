import type { AsyncSubscription } from "@parcel/watcher";
import { subscribe } from "@parcel/watcher";
import { copyFile, mkdir } from "fs/promises";
import path from "path";
import picomatch from "picomatch";

import type { File } from "../types";
import { collapsePaths, debounceAsync, parseImportsDeep } from "../utils";
import { createExecutor, type PipelineExecutorAPI } from "./executor";
import type { AssetpipeOptions } from "./options";

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
    if (this.options.outputDirectory) {
      await mkdir(this.options.outputDirectory, { recursive: true });
    }
    await this.subscribeToSourceCode();
    await this.subscribeToQueries();
    await this.run();
    this.onQueryTriggered.enable();
  }

  async despawn() {
    if (!this.active) return;
    this.active = false;
    await Promise.all([
      this.onQueryTriggered.disable(),
      this.unsubscribeFromSourceCode(),
      this.unsubscribeFromQueries(),
    ]);
  }

  private executor!: PipelineExecutorAPI;
  private sourceCodeSubscriptions?: AsyncSubscription[];

  private async subscribeToSourceCode() {
    this.executor = await createExecutor(this.options);
    const inputFiles = await parseImportsDeep(this.options.entry);
    const inputDirectories = collapsePaths(inputFiles);

    const subscriptions = [];
    for (const directory of inputDirectories) {
      subscriptions.push(
        subscribe(directory, (errs, events) => {
          for (const event of events) {
            if (inputFiles.has(event.path)) {
              this.onSourceCodeChange.call();
              break;
            }
          }
        }),
      );
    }

    await this.executor.executeAllQueries();

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
    const ignore = [];
    for (const info of this.executor.ignores) {
      for (const query of info.query) {
        ignore.push(path.join(info.context, query).replace(/\\/g, "/"));
      }
    }

    const subscriptions = [];
    const subscriptionOptions = { ignore };
    const pendingSubmissions = new Set<Promise<void>>();

    for (
      let pipelineIndex = 0;
      pipelineIndex < this.executor.queries.length;
      pipelineIndex++
    ) {
      const info = this.executor.queries[pipelineIndex];

      for (let queryIndex = 0; queryIndex < info.query.length; queryIndex++) {
        const state = info.states[info.query[queryIndex]];
        const base = path.resolve(state.base);
        const matcher = picomatch(state.glob, {
          windows: process.platform === "win32",
        });

        subscriptions.push(
          subscribe(
            base,
            (err, events) => {
              for (const event of events) {
                const relativePath = path.relative(base, event.path);
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
        const files = await this.executor.computePipelineResults();

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

export async function watch(options: AssetpipeOptions) {
  return new PipelineWatcher(options);
}
