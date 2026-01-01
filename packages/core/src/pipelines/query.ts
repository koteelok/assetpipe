import { File, QueryLike } from "../types";
import { InteractivePipeline, InteractivePipelineOptions } from "./interactive";
import { PipelineMixin } from "./pipeline";

export interface QueryPipelineOptions extends InteractivePipelineOptions {
  query: QueryLike;
  claim?: boolean;
  ignore?: boolean;
  bulk?: boolean;
  groupBy?: (file: File) => string;
}

export interface QueryPipeline extends InteractivePipeline {
  query: QueryLike;
  claim?: boolean;
  ignore?: boolean;
  bulk?: boolean;
  groupBy?: (file: File) => string;
}

export const QueryPipeline = new PipelineMixin(
  (obj: QueryPipeline, options: QueryPipelineOptions) => {
    obj.files = options.files ?? [];
    obj.commands = options.commands ?? [];
    obj.query = options.query;
    obj.claim = options.claim;
    obj.ignore = options.ignore;
    obj.bulk = options.bulk;
    obj.groupBy = options.groupBy;
    return obj;
  },
  InteractivePipeline
);
