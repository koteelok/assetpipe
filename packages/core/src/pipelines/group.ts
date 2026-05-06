import type { InteractiveOptions } from "./interactive";
import { InteractivePipeline } from "./interactive";
import type { Pipeline, PipelineOptions } from "./pipeline";
import { PipelineMixin } from "./pipeline";

export interface GroupOptions extends InteractiveOptions {
  kind: "GroupPipeline";
  children: PipelineOptions[];
}

export interface GroupPipeline extends InteractivePipeline {
  children: Pipeline[];
}

export const GroupPipeline = new PipelineMixin<GroupPipeline, GroupOptions>(
  "GroupPipeline",
  (pipeline, options, materialize) => {
    pipeline.children = options.children.map((c) => materialize(c));
  },
  InteractivePipeline,
);
