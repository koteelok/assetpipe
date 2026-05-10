import type { InteractiveOptions } from "./interactive";
import { InteractivePipeline } from "./interactive";
import type { Pipeline, PipelineOptions } from "./pipeline";
import { PipelineMixin } from "./pipeline";
import type { Slice } from "./slice";

export interface CloneOptions extends InteractiveOptions {
  kind: "ClonePipeline";
  source: PipelineOptions;
}

export interface ClonePipeline extends InteractivePipeline {
  source: Pipeline;
  slices?: Slice[];
}

export const ClonePipeline = new PipelineMixin<ClonePipeline, CloneOptions>(
  "ClonePipeline",
  (pipeline, options, materialize) => {
    pipeline.source = materialize(options.source);
    pipeline.slices = undefined;
  },
  InteractivePipeline,
);
