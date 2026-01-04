import * as mixins from "@assetpipe/core/pipelines";
import { ArrayOr, File, QueryLike, Transformer } from "@assetpipe/core/types";

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
          `Passed argument ${pipeline} is not actually a pipeline!`
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

class QueryPipeline extends InteractivePipeline {}

export const select = {
  parallel(query: QueryLike) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mixin(pipeline, { query });
    return pipeline;
  },

  bulk(query: QueryLike) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mixin(pipeline, { query, bulk: true });
    return pipeline;
  },

  groupBy(query: QueryLike, callback: (file: File) => string) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mixin(pipeline, { query, groupBy: callback });
    return pipeline;
  },
};

export const claim = {
  parallel(query: QueryLike) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mixin(pipeline, { query, claim: true });
    return pipeline;
  },

  bulk(query: QueryLike) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mixin(pipeline, { query, bulk: true, claim: true });
    return pipeline;
  },

  groupBy(query: QueryLike, callback: (file: File) => string) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mixin(pipeline, {
      query,
      groupBy: callback,
      claim: true,
    });
    return pipeline;
  },
};

class IgnorePipeline extends Pipeline {}

export function ignore(query: QueryLike) {
  const pipeline = new IgnorePipeline();
  mixins.IgnorePipeline.mixin(pipeline, { query });
  return pipeline;
}

class FilesPipeline extends InteractivePipeline {}

export function files(files: File[]) {
  const pipeline = new FilesPipeline();
  mixins.FilesPipeline.mixin(pipeline, { files });
  return pipeline;
}

class GroupPipeline extends InteractivePipeline {}

export function group(...pipelines: ArrayOr<Pipeline>[]) {
  const pipeline = new GroupPipeline();
  mixins.GroupPipeline.mixin(pipeline, { children: pipelines.flat() as any[] });
  return pipeline;
}

class ContextPipeline extends GroupPipeline {}

export function context(root: string, ...pipelines: ArrayOr<Pipeline>[]) {
  const pipeline = new ContextPipeline();
  mixins.ContextPipeline.mixin(pipeline, {
    context: root,
    children: pipelines.flat() as any[],
  });
  return pipeline;
}
