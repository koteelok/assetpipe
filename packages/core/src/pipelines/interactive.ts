import type { File, Transformer } from "../types";
import type { Pipeline } from "./pipeline";
import { PipelineMixin } from "./pipeline";

export interface InteractivePipeline extends Pipeline {
  commands: PipelineCommand[];
  cacheHit: boolean;
  firstDirtyPull: number | undefined;
  result: File[];
  resultPromise?: Promise<void>;
}

export const InteractivePipeline = new PipelineMixin<InteractivePipeline>(
  "InteractivePipeline",
  (obj, options) => {
    obj.commands = options.commands ?? [];
    obj.cacheHit = options.cacheHit ?? false;
    obj.firstDirtyPull = options.firstDirtyPull ?? undefined;
    obj.result = options.result ?? [];
    obj.resultPromise = options.resultPromise;
    return obj;
  },
);

export type PipelineCommand =
  | { type: "pipe"; transformer: Transformer }
  | { type: "branch"; transformers: Transformer[] }
  | { type: "pull"; pipeline: Pipeline };
