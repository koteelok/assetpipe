import {
  ContextPipeline,
  FilesPipeline,
  GroupPipeline,
  IgnorePipeline,
  InteractivePipeline as _InteractivePipeline,
  QueryPipeline,
} from "@assetpipe/core/pipelines";
import { ArrayOr, File, QueryLike, Transformer } from "@assetpipe/core/types";

// Fake API-like classes to make user comfortable lol

class Pipeline {}

class InteractivePipeline {
  pipe(transformer: Transformer) {
    const self = this as unknown as _InteractivePipeline;
    self.commands.push({
      type: "pipe",
      transformer,
    });

    return this;
  }

  branch(...transformers: ArrayOr<Transformer>[]) {
    const self = this as unknown as _InteractivePipeline;
    self.commands.push({
      type: "branch",
      transformers: transformers.flat(),
    });

    return this;
  }

  pull(...pipelines: InteractivePipeline[]) {
    const self = this as unknown as _InteractivePipeline;
    for (const pipeline of pipelines) {
      if (!_InteractivePipeline.is(pipeline)) {
        throw new Error(
          `Passed argument ${pipeline} is not actually a pipeline!`
        );
      }

      self.commands.push({
        type: "pull",
        pipeline: pipeline as unknown as _InteractivePipeline,
      });
    }

    return this;
  }
}

export const select = {
  parallel(query: QueryLike) {
    const pipeline = new InteractivePipeline();
    QueryPipeline.mixin(pipeline, { query });
    return pipeline;
  },

  bulk(query: QueryLike) {
    const pipeline = new InteractivePipeline();
    QueryPipeline.mixin(pipeline, { query, bulk: true });
    return pipeline;
  },

  groupBy(query: QueryLike, callback: (file: File) => string) {
    const pipeline = new InteractivePipeline();
    QueryPipeline.mixin(pipeline, { query, groupBy: callback });
    return pipeline;
  },
};

export const claim = {
  parallel(query: QueryLike) {
    const pipeline = new InteractivePipeline();
    QueryPipeline.mixin(pipeline, { query, claim: true });
    return pipeline;
  },

  bulk(query: QueryLike) {
    const pipeline = new InteractivePipeline();
    QueryPipeline.mixin(pipeline, { query, bulk: true, claim: true });
    return pipeline;
  },

  groupBy(query: QueryLike, callback: (file: File) => string) {
    const pipeline = new InteractivePipeline();
    QueryPipeline.mixin(pipeline, {
      query,
      groupBy: callback,
      claim: true,
    });
    return pipeline;
  },
};

export function ignore(query: QueryLike): Pipeline {
  const pipeline = new Pipeline();
  IgnorePipeline.mixin(pipeline, { query });
  return pipeline;
}

export function context(
  root: string,
  ...pipelines: ArrayOr<Pipeline>[]
): InteractivePipeline {
  const pipeline = new InteractivePipeline();
  ContextPipeline.mixin(pipeline, {
    context: root,
    children: pipelines.flat() as any[],
  });
  return pipeline;
}

export function files(files: File[]): InteractivePipeline {
  const pipeline = new InteractivePipeline();
  FilesPipeline.mixin(pipeline, { files });
  return pipeline;
}

export function group(...pipelines: ArrayOr<Pipeline>[]): InteractivePipeline {
  const pipeline = new InteractivePipeline();
  GroupPipeline.mixin(pipeline, { children: pipelines.flat() as any[] });
  return pipeline;
}
