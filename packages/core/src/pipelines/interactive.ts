import { File, Transformer } from "../types";
import { Pipeline, PipelineMixin } from "./pipeline";

export interface InteractivePipelineOptions {
  commands?: PipelineCommand[];
}

export interface InteractivePipeline extends Pipeline {
  commands: PipelineCommand[];
  result: File[];
  resultPromise?: Promise<void>;
}

export const InteractivePipeline = new PipelineMixin(
  "InteractivePipeline",
  (obj: InteractivePipeline, options: InteractivePipelineOptions) => {
    obj.commands = options.commands ?? [];
    obj.result = [];
    return obj;
  }
);

export type PipelineCommand =
  | { type: "pipe"; transformer: Transformer }
  | { type: "branch"; transformers: Transformer[] }
  | { type: "pull"; pipeline: Pipeline };
