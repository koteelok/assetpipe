import { InteractivePipeline, InteractivePipelineOptions } from "./interactive";
import { PipelineMixin } from "./pipeline";
import { Pipeline } from "./pipeline";

export interface GroupPipelineOptions extends InteractivePipelineOptions {
  children: Pipeline[];
}

export interface GroupPipeline extends InteractivePipeline {
  children: Pipeline[];
}

export const GroupPipeline = new PipelineMixin(
  "GroupPipeline",
  (obj: GroupPipeline, options: GroupPipelineOptions) => {
    obj.commands = options.commands ?? [];
    obj.result = [];
    obj.children = options.children;
    return obj;
  },
  InteractivePipeline
);
