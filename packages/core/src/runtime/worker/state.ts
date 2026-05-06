import { createJiti } from "jiti";
import path from "path";
import picomatch from "picomatch";

import {
  ContextPipeline,
  GroupPipeline,
  IgnorePipeline,
  InteractivePipeline,
  type Pipeline,
  PipelineMixin,
  type PipelineOptions,
  QueryPipeline,
  type QueryState,
} from "../../pipelines";
import type { AssetpipeOptions } from "../options";

interface IgnoreInfo {
  context: string;
  query: string[];
}

interface QueryInfo {
  context: string;
  query: string[];
  states: Record<string, QueryState>;
}

export interface SerializedExecutorState {
  queryPipelines: QueryInfo[];
  ignorePipelines: IgnoreInfo[];
  ignorePatterns: string[];
}

export class PipelineState {
  public root!: Pipeline;
  public queryPipelines: QueryPipeline[] = [];
  public ignorePipelines: IgnorePipeline[] = [];
  public ignorePatterns: string[] = [];
  public interactivePipelines: InteractivePipeline[] = [];

  private constructor() {}

  private buildMatchers(parent: QueryPipeline | IgnorePipeline) {
    for (const query of parent.query) {
      const scanned = picomatch.scan(
        path.join(parent.context, query).replace(/\\/g, "/"),
      );
      const state: QueryState =
        scanned.glob === ""
          ? { kind: "file", base: scanned.base }
          : { kind: "glob", base: scanned.base, glob: scanned.glob };
      parent.states[query] = state;
      if (state.kind === "glob") {
        parent.matchers[query] = picomatch(state.glob, {
          windows: process.platform === "win32",
        });
      }
    }
  }

  private prepassPipeline(parent: Pipeline, counter = 0, context = "") {
    if (parent.id !== undefined) {
      return parent.id;
    }

    parent.id = counter++;

    if (InteractivePipeline.is(parent)) {
      this.interactivePipelines.push(parent);
    }

    if (ContextPipeline.is(parent)) {
      context = context ? path.join(parent.context, context) : parent.context;
    }

    if (QueryPipeline.is(parent)) {
      parent.context = context;

      if (!this.queryPipelines.includes(parent)) {
        this.buildMatchers(parent);
        this.queryPipelines.push(parent);
      }
    }

    if (IgnorePipeline.is(parent)) {
      parent.context = context;

      if (!this.ignorePipelines.includes(parent)) {
        this.buildMatchers(parent);
        this.ignorePipelines.push(parent);
        for (const pattern of parent.query) {
          this.ignorePatterns.push(
            path.join(parent.context, pattern).replace(/\\/g, "/"),
          );
        }
      }
    }

    if (GroupPipeline.is(parent)) {
      for (const child of parent.children) {
        counter = this.prepassPipeline(child, counter, context);
      }
    }

    if (InteractivePipeline.is(parent)) {
      for (const command of parent.commands) {
        if (command.type === "pull") {
          counter = this.prepassPipeline(command.pipeline, counter);
        }
      }
    }

    return counter;
  }

  public serialize(): SerializedExecutorState {
    return {
      ignorePipelines: this.ignorePipelines.map((pipeline) => ({
        context: pipeline.context,
        query: pipeline.query,
      })),

      queryPipelines: this.queryPipelines.map((pipeline) => ({
        context: pipeline.context,
        query: pipeline.query,
        states: pipeline.query.reduce(
          (acc, query) => {
            acc[query] = pipeline.states[query];
            return acc;
          },
          {} as Record<string, QueryState>,
        ),
      })),

      ignorePatterns: this.ignorePatterns,
    };
  }

  public static async create(options: AssetpipeOptions) {
    const jiti = createJiti(globalThis.__filename ?? import.meta.url, {
      fsCache: options.cacheDirectory
        ? path.join(options.cacheDirectory, "jiti")
        : false,
    });

    const loaded = await jiti.import<PipelineOptions>(
      path.resolve(options.entry),
      { default: true },
    );

    if (
      !loaded ||
      typeof loaded !== "object" ||
      typeof (loaded as PipelineOptions).kind !== "string"
    ) {
      throw new Error(
        `Default export in file is not a pipeline. (${options.entry})`,
      );
    }

    const state = new PipelineState();
    state.root = PipelineMixin.materialize<Pipeline>(loaded);
    state.prepassPipeline(state.root);

    return state;
  }
}
