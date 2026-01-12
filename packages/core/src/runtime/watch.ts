import type { AsyncSubscription } from "@parcel/watcher";
import { subscribe } from "@parcel/watcher";
import path from "path";

import type { QueryPipeline } from "../pipelines";
import { collapsePaths, debounceAsync } from "../utils";
import type { PipelineCache } from "./cache";
import { createPipelineRuntime } from "./factory";
import type { PipelineRuntime } from "./runtime";

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
    this.onPipelineChange.enable();
    await this.subscribeToPipeline();
    await this.subscribeToInputs();
    await this.run();
    this.onInputChange.enable();
  }

  async despawn() {
    if (!this.active) return;
    this.active = false;
    await Promise.all([
      this.onInputChange.disable(),
      this.unsubscribeFromPipeline(),
      this.unsubscribeFromInputs(),
    ]);
  }

  private runtime!: PipelineRuntime;
  private cache?: PipelineCache;
  private pipelineSubscriptions?: AsyncSubscription[];

  private async subscribeToPipeline() {
    const { runtime, cache, scriptFiles } = await createPipelineRuntime(
      this.options,
    );

    this.runtime = runtime;
    this.cache = cache;

    const subscriptions = [];
    for (const directory of collapsePaths(scriptFiles)) {
      subscriptions.push(
        subscribe(directory, (errs, events) => {
          for (const event of events) {
            if (scriptFiles.has(event.path)) {
              this.onPipelineChange.call();
              break;
            }
          }
        }),
      );
    }

    await this.runtime.executeAllQueries();

    this.pipelineSubscriptions = await Promise.all(subscriptions);
  }

  private async unsubscribeFromPipeline() {
    if (this.pipelineSubscriptions) {
      const unsubscriptions = [];
      for (const subscription of this.pipelineSubscriptions) {
        unsubscriptions.push(subscription.unsubscribe());
      }
      this.pipelineSubscriptions = [];
      await Promise.all(unsubscriptions);
    }
  }

  private onPipelineChange = debounceAsync(async () => {
    await this.despawn();
    await this.spawn();
  }, 100);

  private inputSubscriptions?: AsyncSubscription[];
  private hitQueryPipelines = new Set<QueryPipeline>();

  private async subscribeToInputs() {
    const ignore = [];
    for (const pipeline of this.runtime.ignorePipelines) {
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

    for (const pipeline of this.runtime.queryPipelines) {
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
                if (matcher(relativePath) || matcher(relativePath + path.sep)) {
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

                  pipeline.cacheMisses.add(event.path);
                  this.hitQueryPipelines.add(pipeline);
                  this.onInputChange.call();
                }
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
      const files = await this.runtime.computePipelineResults(
        abortController.signal,
      );

      if (this.cache) {
        await this.cache.save();
      }

      console.log("OUTPUT", files);
    } catch (error) {
      if (this.cache) {
        this.cache.reset();
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
