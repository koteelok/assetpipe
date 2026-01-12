import path from "path";
import { createJiti } from "jiti";

import { parseImportsDeep } from "../utils";
import { Pipeline, PipelineMixin } from "../pipelines";

interface PipelineSourceOptions {
  entry: string;
  cacheDirectory?: string;
}

export class PipelineSource {
  public entry: string;
  public cacheDirectory?: string;

  constructor(options: PipelineSourceOptions) {
    this.entry = options.entry;
    this.cacheDirectory = options.cacheDirectory;
  }

  private scriptFiles?: Set<string>;
  async parseScriptFiles() {
    if (!this.scriptFiles) {
      this.scriptFiles = await parseImportsDeep(this.entry);
    }

    return this.scriptFiles;
  }

  async evaluate() {
    const jiti = createJiti(__filename, {
      fsCache: this.cacheDirectory ? path.join(this.cacheDirectory, "jiti") : false,
    });

    const pipeline = await jiti.import<Pipeline>(
      path.resolve(this.entry),
      { default: true }
    );

    if (!PipelineMixin.is(pipeline)) {
      throw new Error(
        `Default export in file is not a pipeline. (${this.entry})`
      );
    }

    return pipeline;
  }
}
