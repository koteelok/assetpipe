import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import { parentPort } from "worker_threads";

import { PipelineExecutor } from "./executor";

if (parentPort) {
  comlink.expose(new PipelineExecutor(), nodeEndpoint(parentPort));
}

export type { PipelineCache } from "./cache";
export * from "./executor";
