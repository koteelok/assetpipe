import * as mixins from "@assetpipe/core/pipelines";
import type { ArrayOr, File, Transformer } from "@assetpipe/core/types";

// Fake API-like classes to make user comfortable lol

class Pipeline {}

class InteractivePipeline {
  /** Apply a transformer to the pipeline's files. */
  pipe(transformer: Transformer) {
    const self = this as unknown as mixins.InteractiveOptions;
    self.commands.push({
      type: "pipe",
      transformer,
    });

    return this;
  }

  /** Fork the pipeline into multiple transformers that each receive the same input. */
  branch(...transformers: ArrayOr<Transformer>[]) {
    const self = this as unknown as mixins.InteractiveOptions;
    self.commands.push({
      type: "branch",
      transformers: transformers.flat(),
    });

    return this;
  }

  /** Pull results from other pipelines into this one. */
  pull(...pipelines: InteractivePipeline[]) {
    const self = this as unknown as mixins.InteractiveOptions;
    for (const pipeline of pipelines) {
      if (!(pipeline instanceof InteractivePipeline)) {
        throw new Error(
          `Passed argument ${pipeline} is not actually a pipeline!`,
        );
      }

      self.commands.push({
        type: "pull",
        pipeline: pipeline as unknown as mixins.PipelineOptions,
      });
    }

    return this;
  }
}
export type QueryLike = string | string[];

class QueryPipeline extends InteractivePipeline {}

interface QueryOptions {
  /** Take ownership of matched files so later queries on the same glob see nothing. */
  claim?: boolean;
  /** Process each matched file individually instead of passing all at once. */
  parallel?: boolean;
  /** Group matched files by key and run the transformer once per group. */
  groupBy?: (file: File) => string;
}

/** Select files matching a glob pattern and create a pipeline to process them. */
export function query(query: QueryLike, options: QueryOptions = {}) {
  const pipeline = new QueryPipeline();
  const self = pipeline as unknown as mixins.QueryOptions;
  self.kind = "QueryPipeline";
  self.query = Array.isArray(query) ? [...query] : [query];
  self.commands = [];
  self.claim = options.claim;
  self.parallel = options.parallel;
  self.groupBy = options.groupBy;
  return pipeline;
}

class IgnorePipeline extends Pipeline {}

/** Exclude files matching a glob pattern from all other pipelines. */
export function ignore(query: QueryLike) {
  const pipeline = new IgnorePipeline();
  const self = pipeline as unknown as mixins.IgnoreOptions;
  self.kind = "IgnorePipeline";
  self.query = Array.isArray(query) ? [...query] : [query];
  return pipeline;
}

class GroupPipeline extends InteractivePipeline {}

/** Combine multiple pipelines so they run together and their outputs are merged. */
export function group(...pipelines: ArrayOr<Pipeline>[]) {
  const pipeline = new GroupPipeline();
  const self = pipeline as unknown as mixins.GroupOptions;
  self.kind = "GroupPipeline";
  self.commands = [];
  self.children = pipelines.flat() as unknown as mixins.PipelineOptions[];
  return pipeline;
}

class ContextPipeline extends GroupPipeline {}

/** Set a root directory so inner pipeline queries resolve relative to it. */
export function context(root: string, ...pipelines: ArrayOr<Pipeline>[]) {
  const pipeline = new ContextPipeline();
  const self = pipeline as unknown as mixins.ContextOptions;
  self.kind = "ContextPipeline";
  self.commands = [];
  self.context = root;
  self.children = pipelines.flat() as unknown as mixins.PipelineOptions[];
  return pipeline;
}
