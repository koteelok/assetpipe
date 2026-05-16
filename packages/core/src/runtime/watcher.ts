import * as comlink from "comlink";

import {
  applyDefaults,
  type AssetpipeOptions,
  type AssetpipeOptionsWithDefaults,
  type ExecutionMetadata,
} from "./options";
import { createSession } from "./createSession";
import type { File } from "../types";

export class PipelineWatcher {
  private options: AssetpipeOptionsWithDefaults;
  private active = false;
  private terminate?: () => Promise<void>;
  private respawning?: Promise<void>;
  private respawnQueued = false;

  constructor(_options: AssetpipeOptions) {
    if (!_options.outputDirectory && !_options.onOutput) {
      throw new Error("Either outputDirectory or onOutput must be provided");
    }

    this.options = applyDefaults(_options);
  }

  async spawn(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      await this.startSession();
    } catch (err) {
      this.active = false;
      throw err;
    }
  }

  async despawn(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.respawnQueued = false;
    await this.respawning;
    await this.terminate?.();
    this.terminate = undefined;
  }

  private startRespawn(): void {
    this.respawning = (async () => {
      try {
        await this.terminate?.();
        this.terminate = undefined;
        if (this.active) await this.startSession();
      } finally {
        this.respawning = undefined;
        if (this.active && this.respawnQueued) {
          this.respawnQueued = false;
          this.startRespawn();
        }
      }
    })();
  }

  private async startSession(): Promise<void> {
    const { session, terminate } = await createSession(this.options);
    this.terminate = terminate;

    const proxy: <T>(value: T) => T = this.options.useWorker
      ? (comlink.proxy as <T>(value: T) => T)
      : (value) => value;

    await session.runWatch({
      onOutput: proxy(
        (files: File[] | undefined, metadata?: ExecutionMetadata) => {
          if (files) this.options.onOutput?.(files, metadata);
        },
      ),
      onSourceChanged: proxy(() => {
        if (!this.active) return;
        if (this.respawning) {
          this.respawnQueued = true;
          return;
        }
        this.startRespawn();
      }),
      onError: proxy((err: { name: string; message: string }) => {
        const error = new Error(err.message);
        error.name = err.name;
        queueMicrotask(() => {
          throw error;
        });
      }),
    });
  }
}
