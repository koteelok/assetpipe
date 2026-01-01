import { File, QueryLike } from "../types";
import { Pipeline, PipelineMixin } from "./pipeline";

export interface IgnorePipelineOptions {
  query: QueryLike;
}

export interface IgnorePipeline extends Pipeline {
  query: QueryLike;
  files: File[];
}

export const IgnorePipeline = new PipelineMixin(
  "IgnorePipeline",
  (obj: IgnorePipeline, options: IgnorePipelineOptions) => {
    obj.query = options.query;
    obj.files = [];
    return obj;
  }
);
