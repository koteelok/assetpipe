import type picomatch from "picomatch";
import type scan from "picomatch/lib/scan";

import type { File } from "../types";
import { InteractivePipeline } from "./interactive";
import { PipelineMixin } from "./pipeline";

export interface QueryPipeline extends InteractivePipeline {
  query: string[];
  queryResult: File[];
  filteredQueryResult: File[];
  cacheMisses: Set<string>;
  context: string;
  states: Record<string, scan.State>;
  matchers: Record<string, picomatch.Matcher>;
  claim?: boolean;
  ignore?: boolean;
  parallel?: boolean;
  groupBy?: (file: File) => string;
}

export const QueryPipeline = new PipelineMixin<QueryPipeline>(
  "QueryPipeline",
  (obj, options) => {
    obj.query = options.query ?? [];
    obj.queryResult = options.queryResult ?? [];
    obj.filteredQueryResult = options.filteredQueryResult ?? [];
    obj.cacheMisses = options.cacheMisses ?? new Set();
    obj.context = options.context ?? "";
    obj.states = options.states ?? {};
    obj.matchers = options.matchers ?? {};
    obj.claim = options.claim;
    obj.ignore = options.ignore;
    obj.parallel = options.parallel;
    obj.groupBy = options.groupBy;
    return obj;
  },
  InteractivePipeline,
);
