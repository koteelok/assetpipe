import {
  ContextPipeline,
  FilesPipeline,
  IgnorePipeline,
  QueryPipeline,
} from "../pipelines";
import { GroupPipeline } from "../pipelines/group";
import { InteractivePipeline, PipelineCommand } from "../pipelines/interactive";
import { Pipeline, PipelineMixin } from "../pipelines/pipeline";
import { File } from "../types";

const { optionsSymbol } = PipelineMixin;

export function cloneCommands(commands: PipelineCommand[]): PipelineCommand[] {
  const clone: PipelineCommand[] = [];

  for (const command of commands) {
    switch (command.type) {
      case "pipe":
        clone.push({ type: "pipe", transformer: command.transformer });
        break;

      case "branch":
        clone.push({ type: "branch", transformers: [...command.transformers] });
        break;

      case "pull":
        clone.push({ type: "pull", pipeline: clonePipeline(command.pipeline) });
        break;
    }
  }

  return clone;
}

export function cloneFiles(files: File[]): File[] {
  const clone: File[] = [];
  for (const file of files) {
    clone.push({
      metadata: file.metadata,
      basename: file.basename,
      dirname: file.dirname,
      content: file.content,
    });
  }
  return clone;
}

/**
 * Returns stateless copy of a pipeline object.
 */
export function clonePipeline(pipeline: Pipeline): Pipeline {
  if (ContextPipeline.is(pipeline)) {
    const options = pipeline[optionsSymbol];

    return ContextPipeline.mixin(
      {},
      {
        context: options.context,
        commands: options.commands
          ? cloneCommands(options.commands)
          : undefined,
        children: options.children.map((pipeline) => clonePipeline(pipeline)),
      }
    );
  }

  if (FilesPipeline.is(pipeline)) {
    const options = pipeline[optionsSymbol];

    return FilesPipeline.mixin(
      {},
      {
        files: cloneFiles(options.files),
        commands: options.commands
          ? cloneCommands(options.commands)
          : undefined,
      }
    );
  }

  if (GroupPipeline.is(pipeline)) {
    const options = pipeline[optionsSymbol];

    return GroupPipeline.mixin(
      {},
      {
        commands: options.commands
          ? cloneCommands(options.commands)
          : undefined,
        children: options.children.map((pipeline) => clonePipeline(pipeline)),
      }
    );
  }

  if (IgnorePipeline.is(pipeline)) {
    const options = pipeline[optionsSymbol];

    return IgnorePipeline.mixin(
      {},
      {
        query:
          typeof options.query === "string"
            ? options.query
            : [...options.query],
      }
    );
  }

  if (QueryPipeline.is(pipeline)) {
    const options = pipeline[optionsSymbol];

    return QueryPipeline.mixin(
      {},
      {
        query:
          typeof options.query === "string"
            ? options.query
            : [...options.query],
        bulk: options.bulk,
        claim: options.claim,
        commands: options.commands
          ? cloneCommands(options.commands)
          : undefined,
        groupBy: options.groupBy,
      }
    );
  }

  if (InteractivePipeline.is(pipeline)) {
    const options = pipeline[optionsSymbol];

    return InteractivePipeline.mixin(
      {},
      {
        commands: options.commands
          ? cloneCommands(options.commands)
          : undefined,
      }
    );
  }

  throw new Error("Can't clone unknown pipeline mixin.");
}
