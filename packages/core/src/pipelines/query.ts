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
  queryResult: File[];
  context: string;
  claim?: boolean;
  ignore?: boolean;
  bulk?: boolean;
  groupBy?: (file: File) => string;
}

export const QueryPipeline = new PipelineMixin(
  "QueryPipeline",
  (obj: QueryPipeline, options: QueryPipelineOptions) => {
    obj.commands = options.commands ?? [];
    obj.result = [];
    obj.query = options.query;
    obj.queryResult = [];
    obj.context = "";
    obj.claim = options.claim;
    obj.ignore = options.ignore;
    obj.bulk = options.bulk;
    obj.groupBy = options.groupBy;
    return obj;
  },
  InteractivePipeline
);
