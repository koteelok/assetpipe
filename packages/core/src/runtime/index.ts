import { copyFile, mkdir } from "fs/promises";
import { dirname } from "path";

import type { PipelineCache } from "./cache";
import { parsePipelineFile } from "./parse";
import { PipelineWatcher } from "./watch";

export type { PipelineCache, PipelineWatcher };

export interface AssetpipeOptions {
  entry: string;
  outputDirectory: string;
  cacheDirectory?: string;
}

export async function run(options: AssetpipeOptions) {
  const { executor } = await parsePipelineFile(options);
  await executor.executeAllQueries(dirname(options.entry));
  const files = await executor.computePipelineResults();
  if (files) {
    await mkdir(options.outputDirectory, { recursive: true });
    await Promise.all(
      files.map((file) =>
        copyFile(file.content, `${options.outputDirectory}/${file.basename}`),
      ),
    );
  }
}

export async function watcher(options: AssetpipeOptions) {
  return new PipelineWatcher(options);
}
