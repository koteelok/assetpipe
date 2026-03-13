import type { AsyncSubscription } from "@parcel/watcher";
import { subscribe } from "@parcel/watcher";
import path from "path";

import type { QueryPipeline } from "../pipelines";
import { collapsePaths, debounceAsync } from "../utils";
import type { PipelineExecutor } from "./executor";
import { parsePipelineFile } from "./parse";

export interface PipelineWatchOptions {
  entry: string;
  outputDirectory: string;
  cacheDirectory?: string;
}

export class PipelineWatcher {
  constructor(private options: PipelineWatchOptions) {}

  private active = false;

  async spawn() {
    if (this.active) return;
    this.active = true;
    this.onSourceCodeChange.enable();
    await this.subscribeToSourceCode();
    await this.subscribeToInputs();
    await this.run();
    this.onInputChange.enable();
  }

  async despawn() {
    if (!this.active) return;
    this.active = false;
    await Promise.all([
      this.onInputChange.disable(),
      this.unsubscribeFromSourceCode(),
      this.unsubscribeFromInputs(),
    ]);
  }

  private executor!: PipelineExecutor;
  private sourceCodeSubscriptions?: AsyncSubscription[];

  private async subscribeToSourceCode() {
    const { executor, sourceCode } = await parsePipelineFile(this.options);

    this.executor = executor;

    const subscriptions = [];
    for (const directory of collapsePaths(sourceCode)) {
      subscriptions.push(
        subscribe(directory, (errs, events) => {
          for (const event of events) {
            if (sourceCode.has(event.path)) {
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

  private inputSubscriptions?: AsyncSubscription[];
  private hitQueryPipelines = new Set<QueryPipeline>();

  private async subscribeToInputs() {
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

    const subscriptions = [];
    const subscriptionOptions = { ignore };

    for (const pipeline of this.executor.queryPipelines) {
      for (const query in pipeline.states) {
        const state = pipeline.states[query];
        const matcher = pipeline.matchers[query];
        const base = path.resolve(state.base);

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

                if (event.type === "create") {
                  pipeline.queryResult.push({
                    basename: path.basename(event.path),
                    dirname: path.relative(base, path.dirname(event.path)),
                    content: event.path,
                  });
                } else if (event.type === "delete") {
                  for (let i = pipeline.queryResult.length - 1; i >= 0; i--) {
                    if (pipeline.queryResult[i].content === event.path) {
                      pipeline.queryResult.splice(i, 1);
                    }
                  }
                }

                pipeline.cacheHit = false;
                pipeline.cacheMisses.add(event.path);
                this.hitQueryPipelines.add(pipeline);
                this.onInputChange.call();
              }
            },
            subscriptionOptions,
          ),
        );
      }
    }

    this.inputSubscriptions = await Promise.all(subscriptions);
  }

  private onInputChange = debounceAsync(async () => {
    await this.run();
  }, 100);

  private async unsubscribeFromInputs() {
    if (this.inputSubscriptions) {
      const unsubscriptions = [];
      for (const subscription of this.inputSubscriptions) {
        unsubscriptions.push(subscription.unsubscribe());
      }
      this.inputSubscriptions = [];
      await Promise.all(unsubscriptions);
    }
  }

  private lastRun?: Promise<void>;
  private abortController?: AbortController;

  private async run() {
    this.abortController?.abort();

    if (this.lastRun) {
      await this.lastRun;
    }

    const abortController = new AbortController();
    this.abortController = abortController;

    let resolve!: () => void;
    this.lastRun = new Promise((_resolve) => (resolve = _resolve));

    try {
      const files = await this.executor.computePipelineResults(
        abortController.signal,
      );

      if (this.executor.cache) {
        await this.executor.cache.saveResults();
      }

      console.log("OUTPUT", files);
    } catch (error) {
      if (this.executor.cache) {
        this.executor.cache.loadFromBackup();
      }

      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      throw error;
    } finally {
      resolve();
      if (this.abortController === abortController) {
        this.abortController = undefined;
      }
      this.lastRun = undefined;
    }
  }
}
