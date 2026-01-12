import { InteractivePipeline } from "./interactive";
import { PipelineMixin } from "./pipeline";
import { Pipeline } from "./pipeline";

export interface GroupPipeline extends InteractivePipeline {
  children: Pipeline[];
}

export const GroupPipeline = new PipelineMixin<GroupPipeline>(
  "GroupPipeline",
  (obj, options) => {
    obj.commands = options.commands ?? [];
    obj.cacheHit = false;
    obj.result = options.result ?? [];
    obj.children = options.children ?? [];
    return obj;
  },
  InteractivePipeline,
);
