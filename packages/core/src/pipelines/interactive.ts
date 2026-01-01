import { File, Transformer } from "../types";
import { Pipeline, PipelineMixin } from "./pipeline";

export interface InteractivePipelineOptions {
  files?: File[];
  commands?: PipelineCommand[];
}

export interface InteractivePipeline extends Pipeline {
  files: File[];
  commands: PipelineCommand[];
}

export const InteractivePipeline = new PipelineMixin(
  "InteractivePipeline",
  (obj: InteractivePipeline, options: InteractivePipelineOptions) => {
    obj.files = options.files ?? [];
    obj.commands = options.commands ?? [];
    return obj;
  }
);

export type PipelineCommand =
  | { type: "pipe"; transformer: Transformer }
  | { type: "branch"; transformers: Transformer[] }
  | { type: "pull"; pipeline: Pipeline };
