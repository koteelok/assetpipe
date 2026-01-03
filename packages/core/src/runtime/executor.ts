import path from "node:path";

import {
  ContextPipeline,
  FilesPipeline,
  GroupPipeline,
  IgnorePipeline,
  InteractivePipeline,
  QueryPipeline,
} from "../pipelines";
import { Pipeline, PipelineMixin } from "../pipelines/pipeline";
import { executeQuery } from "./query";
import { clonePipeline } from "../utils/clone";
import { File } from "../types";

export class PipelineExecutor {
  root: Pipeline;

  constructor(pipeline: Pipeline) {
    if (!PipelineMixin.is(pipeline)) {
      throw new Error("Invalid object passed as pipeline.");
    }

    this.root = clonePipeline(pipeline);

    this.assignIds(this.root);

    this.acquireQueries(this.root);
  }

  async execute() {
    await this.processQueries();

    await this.orchestratePipeline(this.root);
  }

  private assignIds(parent: Pipeline, counter = 0) {
    if (parent.id !== undefined) return;
    parent.id = "" + counter;
    counter++;

    if (GroupPipeline.is(parent)) {
      for (const child of parent.children) {
        this.assignIds(child, counter);
      }
    }

    if (InteractivePipeline.is(parent)) {
      for (const command of parent.commands) {
        if (command.type === "pull") {
          this.assignIds(command.pipeline, counter);
        }
      }
    }
  }

  private queries: Array<QueryPipeline | IgnorePipeline> = [];

  private acquireQueries(parent: Pipeline, context = "") {
    if (QueryPipeline.is(parent) || IgnorePipeline.is(parent)) {
      parent.context = context;

      if (!this.queries.includes(parent)) {
        this.queries.push(parent);
      }
    }

    if (ContextPipeline.is(parent)) {
      context = context ? path.join(parent.context, context) : parent.context;
    }

    if (GroupPipeline.is(parent)) {
      for (const child of parent.children) {
        this.acquireQueries(child, context);
      }
    }

    if (InteractivePipeline.is(parent)) {
      for (const command of parent.commands) {
        if (command.type === "pull") {
          this.acquireQueries(command.pipeline);
        }
      }
    }
  }

  private async processQueries() {
    await Promise.all(
      this.queries.map(async (pipeline) => {
        const files = await executeQuery(pipeline);
        pipeline.queryResult = files;
      })
    );

    const occupiedFiles = new Set<string>();

    for (const pipeline of this.queries) {
      if (IgnorePipeline.is(pipeline)) {
        for (const file of pipeline.queryResult) {
          occupiedFiles.add(file.content);
        }
      }
    }

    for (const pipeline of this.queries) {
      if (QueryPipeline.is(pipeline)) {
        pipeline.queryResult = pipeline.queryResult.filter(
          (file) => !occupiedFiles.has(file.content)
        );

        if (pipeline.claim) {
          for (const file of pipeline.queryResult) {
            occupiedFiles.add(file.content);
          }
        }
      }
    }
  }

  private async orchestratePipeline(parent: Pipeline) {
    if (!InteractivePipeline.is(parent)) {
      return;
    }

    if (parent.resultPromise) {
      return parent.resultPromise;
    }

    let resolve!: () => void;
    parent.resultPromise = new Promise<void>(
      (_resolve) => (resolve = _resolve)
    );

    if (GroupPipeline.is(parent)) {
      let inputs: File[] = [];

      await Promise.all(
        parent.children.map((child) => this.orchestratePipeline(child))
      );

      for (const child of parent.children) {
        if (InteractivePipeline.is(child)) {
          inputs.push(...child.result);
        }
      }

      parent.result = await this.processCommands(parent, inputs);
    } else if (QueryPipeline.is(parent)) {
      if (parent.bulk) {
        parent.result = await this.processCommands(parent, parent.queryResult);
      } else if (parent.groupBy !== undefined) {
        parent.result = [];

        const tagMap: Record<string, File[]> = {};

        for (const file of parent.queryResult) {
          const tag = parent.groupBy(file);
          if (tagMap[tag] === undefined) {
            tagMap[tag] = [];
          }
          tagMap[tag].push(file);
        }

        for (const tag in tagMap) {
          const files = await this.processCommands(parent, tagMap[tag]);
          parent.result.push(...files);
        }
      } else {
        parent.result = [];

        for (const file of parent.queryResult) {
          const files = await this.processCommands(parent, [file]);
          parent.result.push(...files);
        }
      }
    } else if (FilesPipeline.is(parent)) {
      parent.result = await this.processCommands(parent, parent.files);
    }

    resolve();
    return parent.resultPromise;
  }

  private async processCommands(parent: InteractivePipeline, inputs: File[]) {
    let output = [...inputs];

    for (let i = 0; i < parent.commands.length; i++) {
      const command = parent.commands[i];

      switch (command.type) {
        case "pipe":
          parent.result = await command.transformer(output);
          // parent.files = limitPromise(() => command.transformer(parent.files));
          break;

        case "branch":
          parent.result = await Promise.all(
            command.transformers.map(
              (transformer) =>
                // limitPromise(() =>
                transformer(output)
              // )
            )
          ).then((results) => results.flat());
          break;

        case "pull":
          const pulls: Pipeline[] = [command.pipeline];

          let offset = 1;
          let nextCommand = parent.commands[i + offset];
          while (nextCommand && nextCommand.type === "pull") {
            pulls.push(nextCommand.pipeline);
            offset++;
            nextCommand = parent.commands[i + offset];
          }
          i += offset - 1;

          await Promise.all(
            pulls.map(async (pipeline) => {
              await this.orchestratePipeline(pipeline);

              if (InteractivePipeline.is(pipeline)) {
                output.push(...pipeline.result);
              }
            })
          );
          break;
      }
    }

    return output;
  }
}
