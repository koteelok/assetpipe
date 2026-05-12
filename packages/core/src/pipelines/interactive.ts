import type { File, Transformer } from "../types";
import type { Pipeline, PipelineOptions } from "./pipeline";
import { PipelineMixin } from "./pipeline";

export type PullMatcher = (sourceSlice: File[], pullSlice: File[]) => boolean;

export type CommandOptions =
  | { type: "pipe"; transformer: Transformer }
  | { type: "branch"; transformers: Transformer[] }
  | { type: "pull"; pipeline: PipelineOptions; match?: PullMatcher };

export interface InteractiveOptions extends PipelineOptions {
  commands: CommandOptions[];
}

export type PipelineCommand =
  | { type: "pipe"; transformer: Transformer }
  | { type: "branch"; transformers: Transformer[] }
  | { type: "pull"; pipeline: Pipeline; match?: PullMatcher };

export interface InteractivePipeline extends Pipeline {
  commands: PipelineCommand[];
  cacheHit: boolean;
  firstDirtyPull: number | undefined;
  result: File[];
  resultPromise?: Promise<void>;
}

export const InteractivePipeline = new PipelineMixin<
  InteractivePipeline,
  InteractiveOptions
>("InteractivePipeline", (pipeline, options, materialize) => {
  pipeline.commands = options.commands.map((cmd) => {
    if (cmd.type === "pull") {
      return {
        type: "pull",
        pipeline: materialize(cmd.pipeline),
        match: cmd.match,
      };
    }
    return cmd;
  });
  pipeline.cacheHit = false;
  pipeline.firstDirtyPull = undefined;
  pipeline.result = [];
  pipeline.resultPromise = undefined;
});
