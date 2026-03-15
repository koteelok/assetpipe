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
  QueryPipeline,
} from "../../pipelines";
import { clonePipeline } from "../../utils";
import type { AssetpipeOptions } from "../options";

export class PipelineState {
  public root!: Pipeline;
  public queryPipelines: QueryPipeline[] = [];
  public ignorePipelines: IgnorePipeline[] = [];
  public interactivePipelines: InteractivePipeline[] = [];

  private constructor() {}

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
        for (const query of parent.query) {
          const state = picomatch.scan(
            path.join(parent.context, query).replace(/\\/g, "/"),
          );
          const matcher = picomatch(state.glob, {
            windows: process.platform === "win32",
          });
          parent.states[query] = state;
          parent.matchers[query] = matcher;
        }

        this.queryPipelines.push(parent);
      }
    }

    if (IgnorePipeline.is(parent)) {
      parent.context = context;

      if (!this.ignorePipelines.includes(parent)) {
        this.ignorePipelines.push(parent);
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

  public static async create(options: AssetpipeOptions) {
    const jiti = createJiti(__filename, {
      fsCache: options.cacheDirectory
        ? path.join(options.cacheDirectory, "jiti")
        : false,
    });

    const pipeline = await jiti.import<Pipeline>(path.resolve(options.entry), {
      default: true,
    });

    if (!PipelineMixin.is(pipeline)) {
      throw new Error(
        `Default export in file is not a pipeline. (${options.entry})`,
      );
    }

    const state = new PipelineState();
    state.root = clonePipeline(pipeline);
    state.prepassPipeline(state.root);
    return state;
  }
}
