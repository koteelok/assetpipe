import { GroupPipeline } from "./group";
import type { Pipeline } from "./pipeline";
import { PipelineMixin } from "./pipeline";

export interface ContextPipeline extends GroupPipeline {
  context: string;
  children: Pipeline[];
}

export const ContextPipeline = new PipelineMixin<ContextPipeline>(
  "ContextPipeline",
  (obj, options) => {
    obj.commands = options.commands ?? [];
    obj.result = [];
    obj.cacheHit = false;
    obj.context = options.context ?? "";
    obj.children = options.children ?? [];
    return obj;
  },
  GroupPipeline,
);
