import type { AsyncSubscription } from "@parcel/watcher";
import ParcelWatcher from "@parcel/watcher";
import path from "path";
import picomatch from "picomatch";

import type { File } from "../../types";
import type { ExecutionMetadata } from "../options";
import {
  collapsePaths,
  debounceAsync,
  exists,
  existsFile,
  parseImportsDeep,
} from "../../utils";
import type { PipelineSession } from "./session";

export interface WatchCallbacks {
  onOutput: (files: File[] | undefined, metadata?: ExecutionMetadata) => void;
  onSourceChanged: () => void;
  onError: (error: { name: string; message: string }) => void;
}

export class PipelineWatchSession {
  private sourceCodeSubscriptions?: AsyncSubscription[];
  private querySubscriptions?: AsyncSubscription[];
  private active = false;

  constructor(
    private session: PipelineSession,
    private callbacks: WatchCallbacks,
  ) {}

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;

    await this.subscribeToSourceCode();
    await this.subscribeToQueries();

    await this.runCycle();

    this.onSourceCodeChange.enable();
    this.onQueryTriggered.enable();
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;

    await Promise.all([
      this.onQueryTriggered.disable(),
      this.onSourceCodeChange.disable(),
      this.unsubscribeFromSourceCode(),
      this.unsubscribeFromQueries(),
    ]);
  }

  private async runCycle(): Promise<void> {
    this.session.executor.abort();
    try {
      const result = await this.session.runCycle();
      this.callbacks.onOutput(result.files, result.metadata);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const err =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: "Error", message: String(error) };
      this.callbacks.onError(err);
    }
  }

  private onQueryTriggered = debounceAsync(async () => {
    await this.runCycle();
  }, 100);

  private onSourceCodeChange = debounceAsync(async () => {
    this.callbacks.onSourceChanged();
  }, 100);

  private async subscribeToSourceCode(): Promise<void> {
    const cache = this.session.executor.cache;
    const codeFiles =
      cache?.codeFiles ?? (await parseImportsDeep(this.session.options.entry));
    const codeDirectories = cache?.codeDirectories ?? collapsePaths(codeFiles);

    const subscriptions: Promise<AsyncSubscription>[] = [];
    for (const directory of codeDirectories) {
      subscriptions.push(
        ParcelWatcher.subscribe(directory, (_err, events) => {
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

  private async unsubscribeFromSourceCode(): Promise<void> {
    if (!this.sourceCodeSubscriptions) return;
    const subs = this.sourceCodeSubscriptions;
    this.sourceCodeSubscriptions = undefined;
    await Promise.all(subs.map((s) => s.unsubscribe()));
  }

  private async subscribeToQueries(): Promise<void> {
    const { queryBase } = this.session.options;
    const state = this.session.executor.state;

    const subscriptionOptions = { ignore: state.ignorePatterns };
    const subscriptions: Promise<AsyncSubscription>[] = [];

    for (
      let pipelineIndex = 0;
      pipelineIndex < state.queryPipelines.length;
      pipelineIndex++
    ) {
      const pipeline = state.queryPipelines[pipelineIndex];

      for (
        let queryIndex = 0;
        queryIndex < pipeline.query.length;
        queryIndex++
      ) {
        const query = pipeline.query[queryIndex];
        const queryState = pipeline.states[query];

        switch (queryState.kind) {
          case "file": {
            const filePath = path.resolve(queryBase, queryState.base);
            const fileDirname = path.dirname(filePath);
            const fileBasename = path.basename(filePath);

            if (!(await existsFile(filePath))) {
              console.warn(
                `Failed query (${path.join(pipeline.context, query)}). File does not exist: ${filePath}`,
              );
            }

            subscriptions.push(
              ParcelWatcher.subscribe(
                fileDirname,
                (_err, events) => {
                  for (const event of events) {
                    const relativePath = path.relative(fileDirname, event.path);
                    if (relativePath !== fileBasename) continue;
                    this.submitQueryEvent(
                      pipelineIndex,
                      queryIndex,
                      event.type,
                      event.path,
                    );
                  }
                },
                subscriptionOptions,
              ),
            );
            break;
          }

          case "glob": {
            const basePath = path.resolve(queryBase, queryState.base);
            const matcher = picomatch(queryState.glob, {
              windows: process.platform === "win32",
            });

            if (!(await exists(basePath))) {
              console.warn(
                `Failed query (${path.join(pipeline.context, query)}). Directory does not exist: ${basePath}`,
              );
            }

            subscriptions.push(
              ParcelWatcher.subscribe(
                basePath,
                (_err, events) => {
                  for (const event of events) {
                    const relativePath = path.relative(basePath, event.path);
                    if (
                      !matcher(relativePath) &&
                      !matcher(relativePath + path.sep)
                    ) {
                      continue;
                    }
                    this.submitQueryEvent(
                      pipelineIndex,
                      queryIndex,
                      event.type,
                      event.path,
                    );
                  }
                },
                subscriptionOptions,
              ),
            );
            break;
          }
        }
      }
    }

    this.querySubscriptions = await Promise.all(subscriptions);
  }

  private async unsubscribeFromQueries(): Promise<void> {
    if (!this.querySubscriptions) return;
    const subs = this.querySubscriptions;
    this.querySubscriptions = undefined;
    await Promise.all(subs.map((s) => s.unsubscribe()));
  }

  private submitQueryEvent(
    pipelineIndex: number,
    queryIndex: number,
    eventType: string,
    eventPath: string,
  ): void {
    this.session.executor.submitQueryCacheMiss(
      pipelineIndex,
      queryIndex,
      eventType,
      eventPath,
    );
    this.onQueryTriggered.call();
  }
}
