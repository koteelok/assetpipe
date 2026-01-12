import picomatch from "picomatch";
import scan from "picomatch/lib/scan";

import { File } from "../types";
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
  bulk?: boolean;
  groupBy?: (file: File) => string;
}

export const QueryPipeline = new PipelineMixin<QueryPipeline>(
  "QueryPipeline",
  (obj, options) => {
    obj.commands = options.commands ?? [];
    obj.cacheHit = false;
    obj.result = [];
    obj.query = options.query ?? [];
    obj.queryResult = [];
    obj.filteredQueryResult = [];
    obj.cacheMisses = new Set();
    obj.context = "";
    obj.states = {};
    obj.matchers = {};
    obj.claim = options.claim;
    obj.ignore = options.ignore;
    obj.bulk = options.bulk;
    obj.groupBy = options.groupBy;
    return obj;
  },
  InteractivePipeline,
);
