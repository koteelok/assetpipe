import { Pipeline } from "../pipelines";
import { PipelineCache } from "./cache";
import { PipelineRuntime } from "./runtime";
import { PipelineSource } from "./source";

export interface CreateRuntimeOptions {
  entry: string;
  outputDirectory: string;
  cacheDirectory?: string;
}

export interface CreateRuntimeResult {
  runtime: PipelineRuntime;
  cache?: PipelineCache;
  scriptFiles: Set<string>;
  pipeline: Pipeline;
}

export async function createPipelineRuntime(
  options: CreateRuntimeOptions
): Promise<CreateRuntimeResult> {
  const source = new PipelineSource(options);

  const scriptFiles = await source.parseScriptFiles();
  const pipeline = await source.evaluate();

  let cache: PipelineCache | undefined;

  if (options.cacheDirectory) {
    cache = new PipelineCache(
      options.entry,
      scriptFiles,
      options.cacheDirectory
    );
  }

  const runtime = new PipelineRuntime(pipeline, cache);

  return { runtime, cache, scriptFiles, pipeline };
}
