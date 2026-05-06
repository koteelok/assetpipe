import type picomatch from "picomatch";

import type { File } from "../types";
import type { InteractiveOptions } from "./interactive";
import { InteractivePipeline } from "./interactive";
import { PipelineMixin } from "./pipeline";

export type QueryState =
  | { kind: "file"; base: string }
  | { kind: "glob"; base: string; glob: string };

export interface QueryOptions extends InteractiveOptions {
  kind: "QueryPipeline";
  query: string[];
  claim?: boolean;
  parallel?: boolean;
  groupBy?: (file: File) => string;
}

export interface QueryPipeline extends InteractivePipeline {
  query: string[];
  queryResult: File[];
  filteredQueryResult: File[];
  cacheMisses: Set<string>;
  context: string;
  states: Record<string, QueryState>;
  matchers: Record<string, picomatch.Matcher>;
  claim?: boolean;
  parallel?: boolean;
  groupBy?: (file: File) => string;
}

export const QueryPipeline = new PipelineMixin<QueryPipeline, QueryOptions>(
  "QueryPipeline",
  (pipeline, options) => {
    pipeline.query = [...options.query];
    pipeline.queryResult = [];
    pipeline.filteredQueryResult = [];
    pipeline.cacheMisses = new Set();
    pipeline.context = "";
    pipeline.states = {};
    pipeline.matchers = {};
    pipeline.claim = options.claim;
    pipeline.parallel = options.parallel;
    pipeline.groupBy = options.groupBy;
  },
  InteractivePipeline,
);
