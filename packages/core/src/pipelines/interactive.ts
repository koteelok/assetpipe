import { File, Transformer } from "../types";
import { Pipeline, PipelineMixin } from "./pipeline";

export interface InteractivePipeline extends Pipeline {
  commands: PipelineCommand[];
  cacheHit: boolean;
  result: File[];
  resultPromise?: Promise<void>;
}

export const InteractivePipeline = new PipelineMixin<InteractivePipeline>(
  "InteractivePipeline",
  (obj, options) => {
    obj.commands = options.commands ?? [];
    obj.cacheHit = false;
    obj.result = [];
    return obj;
  },
);

export type PipelineCommand =
  | { type: "pipe"; transformer: Transformer }
  | { type: "branch"; transformers: Transformer[] }
  | { type: "pull"; pipeline: Pipeline };
