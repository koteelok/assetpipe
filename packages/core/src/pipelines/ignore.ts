import type picomatch from "picomatch";
import type scan from "picomatch/lib/scan";

import type { File } from "../types";
import type { Pipeline } from "./pipeline";
import { PipelineMixin } from "./pipeline";

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
