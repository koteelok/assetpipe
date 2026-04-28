import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter.js";
import { parentPort } from "worker_threads";

import { PipelineExecutor } from "./executor";

if (parentPort) {
  comlink.expose(new PipelineExecutor(), nodeEndpoint(parentPort));
}

export type { PipelineCacheManager } from "./cache";
export * from "./executor";
export type { SerializedExecutorState } from "./state";
