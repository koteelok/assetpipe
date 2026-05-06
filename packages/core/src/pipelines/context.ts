import { GroupPipeline } from "./group";
import type { InteractiveOptions } from "./interactive";
import type { Pipeline, PipelineOptions } from "./pipeline";
import { PipelineMixin } from "./pipeline";

export interface ContextOptions extends InteractiveOptions {
  kind: "ContextPipeline";
  context: string;
  children: PipelineOptions[];
}

export interface ContextPipeline extends GroupPipeline {
  context: string;
  children: Pipeline[];
}

export const ContextPipeline = new PipelineMixin<
  ContextPipeline,
  ContextOptions
>(
  "ContextPipeline",
  (pipeline, options) => {
    pipeline.context = options.context;
  },
  GroupPipeline,
);
