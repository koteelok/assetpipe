import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import { copyFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { Simplify } from "type-fest";
import { Worker } from "worker_threads";

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
  } & OnlyAsyncMethods<PipelineExecutor>
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

  api = api as unknown as PipelineExecutorAPI;

  const { ignores, queries } = await api.init(options);

  api.queries = queries;
  api.ignores = ignores;

  return api;
}

export async function run(options: AssetpipeOptions) {
  const executor = await createExecutor(options);
  await executor.hitQueriesAgainstCache(dirname(options.entry));
  await executor.loadResultsFromCache();
  await executor.executeAllQueries(dirname(options.entry));
  const files = await executor.computePipelineResults();
  await executor.saveResultsToCache();
  if (files) {
    await mkdir(options.outputDirectory, { recursive: true });
    await Promise.all(
      files.map((file) =>
        copyFile(file.content, `${options.outputDirectory}/${file.basename}`),
      ),
    );
  }
}
