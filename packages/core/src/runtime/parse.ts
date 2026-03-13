import { createJiti } from "jiti";
import path from "path";

import { type Pipeline, PipelineMixin } from "../pipelines";
import { collapsePaths, parseImportsDeep } from "../utils";
import type { AssetpipeOptions } from ".";
import { PipelineCache } from "./cache";
import { PipelineExecutor } from "./executor";

export async function parsePipelineFile(options: AssetpipeOptions) {
  const jiti = createJiti(__filename, {
    fsCache: options.cacheDirectory
      ? path.join(options.cacheDirectory, "jiti")
      : false,
  });

  const pipeline = await jiti.import<Pipeline>(path.resolve(options.entry), {
    default: true,
  });

  if (!PipelineMixin.is(pipeline)) {
    throw new Error(
      `Default export in file is not a pipeline. (${options.entry})`,
    );
  }

  const sourceCode = await parseImportsDeep(options.entry);
  const sourceCodeDirectories = collapsePaths(sourceCode);

  const executor = new PipelineExecutor(pipeline);

  if (options.cacheDirectory) {
    executor.cache = new PipelineCache(
      options.entry,
      options.cacheDirectory,
      sourceCode,
      executor,
    );
    await executor.cache.init();
  }

  return { executor, sourceCode, sourceCodeDirectories };
}
