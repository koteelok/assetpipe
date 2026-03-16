import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import { copyFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { Worker } from "worker_threads";

import type { IgnorePipeline, QueryPipeline } from "../pipelines";
import type { AssetpipeOptions } from "./options";
import { IgnoreInfo, PipelineExecutorApi, QueryInfo } from "./worker";

export class PipelineExecutor {
  private api!: PipelineExecutorApi | comlink.Remote<PipelineExecutorApi>;

  public ignores!: IgnoreInfo[];
  public queries!: QueryInfo[];

  async init(options: AssetpipeOptions) {
    if (options.useWorker === false) {
      this.api = new PipelineExecutorApi();
    } else {
      this.api = comlink.wrap<PipelineExecutorApi>(
        nodeEndpoint(new Worker(`${__dirname}/worker/index.js`)),
      );
    }

    const { ignores, queries } = await this.api.init(options);
    this.ignores = ignores;
    this.queries = queries;
  }

  executeQuery(pipeline: QueryPipeline | IgnorePipeline, cwd = process.cwd()) {
    return this.api.executeQuery(pipeline, cwd);
  }

  executeAllQueries(cwd = process.cwd()) {
    return this.api.executeAllQueries(cwd);
  }

  computePipelineResults() {
    return this.api.computePipelineResults();
  }

  abort() {
    return this.api.abort();
  }

  submitQueryCacheMiss(
    pipelineIndex: number,
    queryIndex: number,
    eventType: string,
    eventPath: string,
  ) {
    return this.api.submitQueryCacheMiss(
      pipelineIndex,
      queryIndex,
      eventType,
      eventPath,
    );
  }

  async saveResultsToCache() {
    return this.api.saveResultsToCache();
  }

  async loadResultsFromCache() {
    return this.api.loadResultsFromCache();
  }

  async hitQueriesAgainstCache(cwd = process.cwd()) {
    return this.api.hitQueriesAgainstCache(cwd);
  }

  async restoreCacheFromBackup() {
    return this.api.restoreCacheFromBackup();
  }
}

export async function run(options: AssetpipeOptions) {
  const executor = new PipelineExecutor();
  await executor.init(options);
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
