import picomatch from "picomatch";
import scan from "picomatch/lib/scan";

import { File } from "../types";
import { Pipeline, PipelineMixin } from "./pipeline";

export interface IgnorePipeline extends Pipeline {
  query: string[];
  queryResult: File[];
  context: string;
  states: Record<string, scan.State>;
  matchers: Record<string, picomatch.Matcher>;
}

export const IgnorePipeline = new PipelineMixin<IgnorePipeline>(
  "IgnorePipeline",
  (obj, options) => {
    obj.query = options.query ?? [];
    obj.queryResult = [];
    obj.context = "";
    return obj;
  },
);
