import * as comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter.js";
import path from "path";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";

import { applyDefaults, type AssetpipeOptions } from "./options";
import { PipelineSession } from "./worker/session";

export interface InitializedSession {
  session: comlink.Remote<PipelineSession> | PipelineSession;
  terminate: () => Promise<void>;
}

export async function createSession(
  options: AssetpipeOptions,
): Promise<InitializedSession> {
  const opts = applyDefaults(options);

  if (opts.useWorker) {
    const dirname =
      globalThis.__dirname ?? path.dirname(fileURLToPath(import.meta.url));
    const worker = new Worker(`${dirname}/worker/session.js`);
    const session = comlink.wrap<PipelineSession>(nodeEndpoint(worker));

    try {
      await session.init({ ...opts, onOutput: undefined });
    } catch (err) {
      try {
        await session.dispose();
      } finally {
        session[comlink.releaseProxy]();
        await worker.terminate();
      }
      throw err;
    }

    return {
      session,
      terminate: async () => {
        await session.dispose();
        session[comlink.releaseProxy]();
        await worker.terminate();
      },
    };
  } else {
    const session = new PipelineSession();
    try {
      await session.init(opts);
    } catch (err) {
      await session.dispose();
      throw err;
    }
    return {
      session,
      terminate: async () => {
        await session.dispose();
      },
    };
  }
}
