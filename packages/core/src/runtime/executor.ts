import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter.js";
import { randomUUID } from "crypto";
import { copyFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import type { Simplify } from "type-fest";
import { Worker } from "worker_threads";

import {
  applyDefaults,
  type AssetpipeOptions,
  type ExecutionMetadata,
} from "./options";
import { PipelineExecutor } from "./worker";
import path from "path";
import { fileURLToPath } from "url";

type OnlyAsyncMethods<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => Promise<any>
    ? K
    : never]: T[K];
};

export type PipelineExecutorAPI = Simplify<
  Omit<OnlyAsyncMethods<PipelineExecutor>, "init">
>;

export async function createExecutor(_options: AssetpipeOptions) {
  const options = applyDefaults(_options);

  let api;

  if (options.useWorker) {
    let __dirname =
      globalThis.__dirname ?? path.dirname(fileURLToPath(import.meta.url));
    api = comlink.wrap<PipelineExecutor>(
      nodeEndpoint(new Worker(`${__dirname}/worker/index.js`)),
    );
  } else {
    api = new PipelineExecutor();
  }

  const state = await api.init(options);

  return { state, executor: api as PipelineExecutorAPI };
}

export async function run(options: AssetpipeOptions) {
  const { outputDirectory, cacheDirectory, onOutput } = options;

  if (!outputDirectory && !onOutput) {
    throw new Error("Either outputDirectory or onOutput must be provided");
  }

  const { executor } = await createExecutor(options);

  if (cacheDirectory) {
    await executor.hitQueriesAgainstCache();
    await executor.loadResultsFromCache();
  }

  await executor.executeAllQueries();

  let tempDirectory: string;
  if (cacheDirectory) {
    const cacheTempDirectory = await executor.cacheTempDirectory();
    if (!cacheTempDirectory) {
      throw new Error(
        "Failed to acquire cache temp directory from PipelineExecutorAPI",
      );
    }
    tempDirectory = cacheTempDirectory;
  } else {
    tempDirectory = path.join(tmpdir(), randomUUID());
    await mkdir(tempDirectory, { recursive: true });
  }

  const files = await executor.computePipelineOutput(tempDirectory);

  let outputChanges: ExecutionMetadata | undefined;

  if (cacheDirectory) {
    const redundantTempFiles = await executor.getCacheRedundantTempFiles()!;
    if (redundantTempFiles) {
      await Promise.all(
        redundantTempFiles.map((tempContent) => {
          return rm(tempContent, { recursive: true, force: true });
        }),
      );
    }

    outputChanges = await executor.getExecutionMetadata();

    if (outputChanges && outputDirectory) {
      await Promise.all(
        outputChanges.removedFiles.map((file) => {
          const filePath = path.join(
            outputDirectory,
            file.dirname,
            file.basename,
          );
          return rm(filePath, { force: true });
        }),
      );
    }
  } else {
    if (outputDirectory) {
      await rm(outputDirectory, { recursive: true });
    }
  }

  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
  }

  if (files) {
    if (outputDirectory) {
      await Promise.all(
        files.map((file) => {
          const filePath = path.join(
            outputDirectory,
            file.dirname,
            file.basename,
          );
          return copyFile(file.content, filePath);
        }),
      );
    }

    onOutput?.(files, outputChanges);
  }

  if (cacheDirectory) {
    await executor.saveResultsToCache();
  } else {
    await rm(tempDirectory, { recursive: true });
  }
}
