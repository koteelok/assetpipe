import * as mixins from "@assetpipe/core/pipelines";
import { ArrayOr, File, Transformer } from "@assetpipe/core/types";
import { QueryLike, queryArray } from "./query";

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
    mixins.QueryPipeline.mix(pipeline, { query: queryArray(query) });
    return pipeline;
  },

  bulk(query: QueryLike) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mix(pipeline, {
      query: queryArray(query),
      bulk: true,
    });
    return pipeline;
  },

  groupBy(query: QueryLike, callback: (file: File) => string) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mix(pipeline, {
      query: queryArray(query),
      groupBy: callback,
    });
    return pipeline;
  },
};

export const claim = {
  parallel(query: QueryLike) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mix(pipeline, {
      query: queryArray(query),
      claim: true,
    });
    return pipeline;
  },

  bulk(query: QueryLike) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mix(pipeline, {
      query: queryArray(query),
      bulk: true,
      claim: true,
    });
    return pipeline;
  },

  groupBy(query: QueryLike, callback: (file: File) => string) {
    const pipeline = new QueryPipeline();
    mixins.QueryPipeline.mix(pipeline, {
      query: queryArray(query),
      groupBy: callback,
      claim: true,
    });
    return pipeline;
  },
};

class IgnorePipeline extends Pipeline {}

export function ignore(query: QueryLike) {
  const pipeline = new IgnorePipeline();
  mixins.IgnorePipeline.mix(pipeline, { query: queryArray(query) });
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
