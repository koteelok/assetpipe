import * as mixins from "@assetpipe/core/pipelines";
import type { ArrayOr, File, Transformer } from "@assetpipe/core/types";

// Fake API-like classes to make user comfortable lol

class Pipeline {}

class InteractivePipeline {
  /** Apply a transformer to the pipeline's files. */
  pipe(transformer: Transformer) {
    const self = this as unknown as mixins.InteractivePipeline;
    self.commands.push({
      type: "pipe",
      transformer,
    });

    return this;
  }

  /** Fork the pipeline into multiple transformers that each receive the same input. */
  branch(...transformers: ArrayOr<Transformer>[]) {
    const self = this as unknown as mixins.InteractivePipeline;
    self.commands.push({
      type: "branch",
      transformers: transformers.flat(),
    });

    return this;
  }

  /** Pull results from other pipelines into this one. */
  pull(...pipelines: InteractivePipeline[]) {
    const self = this as unknown as mixins.InteractivePipeline;
    for (const pipeline of pipelines) {
      if (!mixins.InteractivePipeline.is(pipeline)) {
        throw new Error(
          `Passed argument ${pipeline} is not actually a pipeline!`,
        );
      }

      self.commands.push({
        type: "pull",
        pipeline: pipeline as unknown as mixins.InteractivePipeline,
      });
    }

    return this;
  }
}
export type QueryLike = string | string[];

class QueryPipeline extends InteractivePipeline {}

declare global {
  namespace AssetpipeMixins {
    interface QueryOptions {}
  }
}

interface QueryOptions extends AssetpipeMixins.QueryOptions {
  /** Take ownership of matched files so later queries on the same glob see nothing. */
  claim?: boolean;
  /** Pass all matched files to the transformer at once instead of one at a time. */
  bulk?: boolean;
  /** Group matched files by key and run the transformer once per group. */
  groupBy?: (file: File) => string;
}

/** Select files matching a glob pattern and create a pipeline to process them. */
export function query(query: QueryLike, options: QueryOptions) {
  const pipeline = new QueryPipeline();
  mixins.QueryPipeline.mix(pipeline, {
    query: Array.isArray(query) ? [...query] : [query],
    ...options,
  });
  return pipeline;
}

class IgnorePipeline extends Pipeline {}

/** Exclude files matching a glob pattern from all other pipelines. */
export function ignore(query: QueryLike) {
  const pipeline = new IgnorePipeline();
  mixins.IgnorePipeline.mix(pipeline, {
    query: Array.isArray(query) ? [...query] : [query],
  });
  return pipeline;
}

class GroupPipeline extends InteractivePipeline {}

/** Combine multiple pipelines so they run together and their outputs are merged. */
export function group(...pipelines: ArrayOr<Pipeline>[]) {
  const pipeline = new GroupPipeline();
  mixins.GroupPipeline.mix(pipeline, { children: pipelines.flat() as any[] });
  return pipeline;
}

class ContextPipeline extends GroupPipeline {}

/** Set a root directory so inner pipeline queries resolve relative to it. */
export function context(root: string, ...pipelines: ArrayOr<Pipeline>[]) {
  const pipeline = new ContextPipeline();
  mixins.ContextPipeline.mix(pipeline, {
    context: root,
    children: pipelines.flat() as any[],
  });
  return pipeline;
}
