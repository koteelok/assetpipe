import type picomatch from "picomatch";

import type { File } from "../types";
import type { Pipeline, PipelineOptions } from "./pipeline";
import { PipelineMixin } from "./pipeline";
import type { QueryState } from "./query";

export interface IgnoreOptions extends PipelineOptions {
  kind: "IgnorePipeline";
  query: string[];
}

export interface IgnorePipeline extends Pipeline {
  query: string[];
  queryResult: File[];
  context: string;
  states: Record<string, QueryState>;
  matchers: Record<string, picomatch.Matcher>;
}

export const IgnorePipeline = new PipelineMixin<IgnorePipeline, IgnoreOptions>(
  "IgnorePipeline",
  (pipeline, options) => {
    pipeline.query = [...options.query];
    pipeline.queryResult = [];
    pipeline.context = "";
    pipeline.states = {};
    pipeline.matchers = {};
  },
);
