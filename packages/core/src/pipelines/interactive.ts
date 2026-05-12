import type { File, Transformer } from "../types";
import type { Pipeline, PipelineOptions } from "./pipeline";
import { PipelineMixin } from "./pipeline";

export type CommandOptions =
  | { type: "pipe"; transformer: Transformer }
  | { type: "branch"; transformers: Transformer[] }
  | { type: "pull"; pipeline: PipelineOptions };

export interface InteractiveOptions extends PipelineOptions {
  commands: CommandOptions[];
  source?: PipelineOptions;
}

export type PipelineCommand =
  | { type: "pipe"; transformer: Transformer }
  | { type: "branch"; transformers: Transformer[] }
  | { type: "pull"; pipeline: Pipeline };

export interface InteractivePipeline extends Pipeline {
  commands: PipelineCommand[];
  source?: Pipeline;
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
      return { type: "pull", pipeline: materialize(cmd.pipeline) };
    }
    return cmd;
  });
  pipeline.source = options.source ? materialize(options.source) : undefined;
  pipeline.cacheHit = false;
  pipeline.firstDirtyPull = undefined;
  pipeline.result = [];
  pipeline.resultPromise = undefined;
});
