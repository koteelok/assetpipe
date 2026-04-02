import * as mixins from "@assetpipe/core/pipelines";
import type { ArrayOr, File, Transformer } from "@assetpipe/core/types";

// Fake API-like classes to make user comfortable lol

class Pipeline {}

class InteractivePipeline {
  pipe(transformer: Transformer) {
    const self = this as unknown as mixins.InteractivePipeline;
    self.commands.push({
      type: "pipe",
      transformer,
    });

    return this;
  }

  branch(...transformers: ArrayOr<Transformer>[]) {
    const self = this as unknown as mixins.InteractivePipeline;
    self.commands.push({
      type: "branch",
      transformers: transformers.flat(),
    });

    return this;
  }

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
  claim?: boolean;
  bulk?: boolean;
  groupBy?: (file: File) => string;
}

export function query(query: QueryLike, options: QueryOptions) {
  const pipeline = new QueryPipeline();
  mixins.QueryPipeline.mix(pipeline, {
    query: Array.isArray(query) ? [...query] : [query],
    ...options,
  });
  return pipeline;
}

class IgnorePipeline extends Pipeline {}

export function ignore(query: QueryLike) {
  const pipeline = new IgnorePipeline();
  mixins.IgnorePipeline.mix(pipeline, {
    query: Array.isArray(query) ? [...query] : [query],
  });
  return pipeline;
}

class GroupPipeline extends InteractivePipeline {}

export function group(...pipelines: ArrayOr<Pipeline>[]) {
  const pipeline = new GroupPipeline();
  mixins.GroupPipeline.mix(pipeline, { children: pipelines.flat() as any[] });
  return pipeline;
}

class ContextPipeline extends GroupPipeline {}

export function context(root: string, ...pipelines: ArrayOr<Pipeline>[]) {
  const pipeline = new ContextPipeline();
  mixins.ContextPipeline.mix(pipeline, {
    context: root,
    children: pipelines.flat() as any[],
  });
  return pipeline;
}
