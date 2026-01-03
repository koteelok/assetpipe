import { File } from "../types";
import { InteractivePipeline, InteractivePipelineOptions } from "./interactive";
import { PipelineMixin } from "./pipeline";

export interface FilesPipelineOptions extends InteractivePipelineOptions {
  files: File[];
}

export interface FilesPipeline extends InteractivePipeline {
  files: File[];
}

export const FilesPipeline = new PipelineMixin(
  "FilesPipeline",
  (obj: FilesPipeline, options: FilesPipelineOptions) => {
    obj.files = options.files;
    obj.commands = [];
    obj.result = [];
    return obj;
  },
  InteractivePipeline
);
