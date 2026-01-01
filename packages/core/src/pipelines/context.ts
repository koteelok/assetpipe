import { PipelineMixin } from "./pipeline";
import { Pipeline } from "./pipeline";
import { GroupPipeline, GroupPipelineOptions } from "./group";

export interface ContextPipelineOptions extends GroupPipelineOptions {
  context: string;
  children: Pipeline[];
}

export interface ContextPipeline extends GroupPipeline {
  context: string;
  children: Pipeline[];
}

export const ContextPipeline = new PipelineMixin(
  "ContextPipeline",
  (obj: ContextPipeline, options: ContextPipelineOptions) => {
    obj.files = options.files ?? [];
    obj.commands = options.commands ?? [];
    obj.context = options.context;
    obj.children = options.children;
    return obj;
  },
  GroupPipeline
);
