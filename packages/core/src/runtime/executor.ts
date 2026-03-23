import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import { randomUUID } from "crypto";
import { copyFile, mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import type { Simplify } from "type-fest";
import { Worker } from "worker_threads";

import type { File } from "../types";
import type { AssetpipeOptions } from "./options";
import { PipelineExecutor } from "./worker";

type OnlyAsyncMethods<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => Promise<any>
    ? K
    : never]: T[K];
};

export type PipelineExecutorAPI = Simplify<
  Omit<OnlyAsyncMethods<PipelineExecutor>, "init">
>;

export async function createExecutor(options: AssetpipeOptions) {
  let api;

  if (options.useWorker === false) {
    api = new PipelineExecutor();
  } else {
    api = comlink.wrap<PipelineExecutor>(
      nodeEndpoint(new Worker(`${__dirname}/worker/index.js`)),
    );
  }

  const state = await api.init({
    entry: options.entry,
    cacheDirectory: options.cacheDirectory,
    outputDirectory: options.outputDirectory,
    useWorker: options.useWorker,
  });

  return { state, executor: api as PipelineExecutorAPI };
}

type AssetpipeRunOptions = AssetpipeOptions & {
  onOutput?: (files: File[]) => Promise<void>;
};

export async function run(options: AssetpipeRunOptions) {
  if (!options.outputDirectory && !options.onOutput) {
    throw new Error("Either outputDirectory or onOutput must be provided");
  }

  const { executor } = await createExecutor(options);

  if (options.cacheDirectory) {
    await executor.hitQueriesAgainstCache();
    await executor.loadResultsFromCache();
  }

  await executor.executeAllQueries();

  let tempDirectory: string;
  if (options.cacheDirectory) {
    const cacheTempDirectory = await executor.cacheTempDirectory();
    if (!cacheTempDirectory) {
      throw new Error(
        "Failed to acquire cache temp directory from PipelineExecutorAPI",
      );
    }
    tempDirectory = cacheTempDirectory;
  } else {
    tempDirectory = `${tmpdir()}/${randomUUID()}`;
    await mkdir(tempDirectory, { recursive: true });
  }

  const files = await executor.computePipelineResults(tempDirectory);

  if (options.cacheDirectory) {
    const diff = await executor.getCacheDiff();
    if (diff) {
      await Promise.all(
        diff.removedTempFiles.map((file) =>
          rm(file, { force: true }),
        ),
      );

      if (options.outputDirectory) {
        await Promise.all(
          diff.removedOutputFiles.map((basename) =>
            rm(`${options.outputDirectory}/${basename}`, { force: true }),
          ),
        );
      }
    }
  }

  if (options.outputDirectory) {
    await mkdir(options.outputDirectory, { recursive: true });
  }

  if (files) {
    if (options.outputDirectory) {
      await Promise.all(
        files.map((file) =>
          copyFile(file.content, `${options.outputDirectory}/${file.basename}`),
        ),
      );
    }

    if (options.onOutput) {
      await options.onOutput(files);
    }
  }

  if (options.cacheDirectory) {
    await executor.saveResultsToCache();
  } else {
    await rm(tempDirectory, { recursive: true });
  }
}
