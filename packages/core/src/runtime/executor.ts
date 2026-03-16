import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import { copyFile, mkdir } from "fs/promises";
import type { Simplify } from "type-fest";
import { Worker } from "worker_threads";

import type { File } from "../types";
import type { AssetpipeOptions } from "./options";
import type { IgnoreInfo, QueryInfo } from "./worker";
import { PipelineExecutor } from "./worker";

type OnlyAsyncMethods<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => Promise<any>
    ? K
    : never]: T[K];
};

export type PipelineExecutorAPI = Simplify<
  {
    ignores: IgnoreInfo[];
    queries: QueryInfo[];
  } & Omit<OnlyAsyncMethods<PipelineExecutor>, "init">
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

  const { ignores, queries } = await api.init({
    entry: options.entry,
    cacheDirectory: options.cacheDirectory,
    outputDirectory: options.outputDirectory,
    useWorker: options.useWorker,
  });

  api = api as unknown as PipelineExecutorAPI;

  api.queries = queries;
  api.ignores = ignores;

  return api;
}

type AssetpipeRunOptions = AssetpipeOptions & {
  onOutput?: (files: File[]) => void;
};

export async function run(options: AssetpipeRunOptions) {
  const executor = await createExecutor(options);
  await executor.hitQueriesAgainstCache();
  await executor.loadResultsFromCache();
  await executor.executeAllQueries();
  const files = await executor.computePipelineResults();
  await executor.saveResultsToCache();

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

    options.onOutput?.(files);
  }
}
