import { readdir } from "node:fs/promises";
import path from "node:path";

import picomatch from "picomatch";

import {
  ContextPipeline,
  FilesPipeline,
  GroupPipeline,
  IgnorePipeline,
  InteractivePipeline,
  QueryPipeline,
} from "../pipelines";
import { Pipeline, PipelineMixin } from "../pipelines/pipeline";
import { exists } from "../utils/exists";
import { File } from "../types";

export class PipelineExecutor {
  root: Pipeline;

  constructor(pipeline: Pipeline) {
    if (!PipelineMixin.is(pipeline)) {
      throw new Error("Invalid object passed as pipeline.");
    }

    this.root = pipeline;
  }

  async execute() {
    this.assignIds();
    await this.executeAllQueries();
    this.delaminatePipelines();
  }

  private assignIds() {
    const pipelines: Pipeline[] = [this.root];
    let idCounter = 0;

    do {
      const parent = pipelines.pop()!;

      if (parent.id !== undefined) continue;

      parent.id = "" + idCounter;
      idCounter++;

      if (GroupPipeline.is(parent)) {
        for (const child of parent.children) {
          pipelines.push(child);
        }
      }

      if (InteractivePipeline.is(parent)) {
        for (const command of parent.commands) {
          if (command.type === "pull") {
            pipelines.push(command.pipeline);
          }
        }
      }
    } while (pipelines.length);
  }

  private async executeQuery(
    pipeline: IgnorePipeline | QueryPipeline,
    context = ""
  ) {
    const files: File[] = [];
    const queryArray: string[] = [];

    if (Array.isArray(pipeline.query)) {
      queryArray.push(...pipeline.query);
    } else {
      queryArray.push(pipeline.query);
    }

    for (const query of queryArray) {
      const state = picomatch.scan(
        path.join(context, query).replace(/\\/g, "/")
      );
      const basePath = path.resolve(process.cwd(), state.base);

      if (state.glob === "") {
        if (!(await exists(basePath))) {
          throw new Error(
            `[${query}] Query error. File ${basePath} not found.`
          );
        }

        files.push({
          dirname: "",
          basename: path.basename(state.base),
          content: basePath,
        });

        continue;
      }

      const dirents = await readdir(basePath, {
        recursive: true,
        withFileTypes: true,
      }).catch(() => []);

      if (dirents.length === 0) return;

      dirents.sort((a, b) => {
        const aPath = path.join(a.parentPath, a.name);
        const bPath = path.join(b.parentPath, b.name);
        return aPath.localeCompare(bPath);
      });

      const matcher = picomatch(state.glob, {
        windows: process.platform === "win32",
      });

      for (const dirent of dirents) {
        if (!dirent.isFile()) continue;

        const fullPath = path.join(dirent.parentPath, dirent.name);
        const isMatch = matcher(path.relative(basePath, fullPath));

        if (!isMatch) continue;

        files.push({
          basename: dirent.name,
          dirname: path.relative(basePath, dirent.parentPath),
          content: fullPath,
        });
      }
    }

    pipeline.files.push(...files);

    return;
  }

  private async executeAllQueries() {
    const pipelines: Pipeline[] = [this.root];
    const contextMap = new Map<Pipeline, string>();
    const pendingQueries = new Map<
      IgnorePipeline | QueryPipeline,
      Promise<void>
    >();

    do {
      const parent = pipelines.pop();

      if (QueryPipeline.is(parent)) {
        if (pendingQueries.has(parent)) {
          continue;
        }

        pendingQueries.set(
          parent,
          this.executeQuery(parent, contextMap.get(parent))
        );
      }

      if (ContextPipeline.is(parent)) {
        for (const child of parent.children) {
          const currentContext = contextMap.get(child);
          contextMap.set(
            child,
            currentContext
              ? path.join(parent.context, currentContext)
              : parent.context
          );
        }
      }

      if (GroupPipeline.is(parent)) {
        for (const child of parent.children) {
          pipelines.push(child);
        }

        parent.children = parent.children.filter(
          (child) => !IgnorePipeline.is(child)
        );
      }

      if (InteractivePipeline.is(parent)) {
        for (const command of parent.commands) {
          if (command.type === "pull") {
            pipelines.push(command.pipeline);
          }
        }
      }
    } while (pipelines.length);

    await Promise.all(pendingQueries.values());

    const occupiedFiles = new Set<string>();

    for (const pipeline of pendingQueries.keys()) {
      if (IgnorePipeline.is(pipeline)) {
        for (const file of pipeline.files) {
          occupiedFiles.add(file.content);
        }
      }
    }

    for (const pipeline of pendingQueries.keys()) {
      if (QueryPipeline.is(pipeline)) {
        pipeline.files = pipeline.files.filter(
          (file) => !occupiedFiles.has(file.content)
        );

        if (pipeline.claim) {
          for (const file of pipeline.files) {
            occupiedFiles.add(file.content);
          }
        }
      }
    }
  }

  private delaminatePipelines() {
    const pipelines: Pipeline[] = [this.root];

    do {
      const parent = pipelines.pop()!;

      if (parent.delaminated) continue;
      parent.delaminated = true;

      if (QueryPipeline.is(parent)) {
        if (parent.bulk) continue;

        if (parent.groupBy !== undefined) {
          const children: Pipeline[] = [];
          const tagMap: Record<string, File[]> = {};

          for (const file of parent.files) {
            const tag = parent.groupBy(file);

            if (tagMap[tag] === undefined) {
              tagMap[tag] = [];
            }

            tagMap[tag].push(file);
          }

          for (const tag in tagMap) {
            const child = FilesPipeline.mixin(
              {},
              {
                files: tagMap[tag],
                commands: parent.commands,
              }
            );
            child.id = `${parent.id}_${tag}`;
            children.push(child);
          }

          GroupPipeline.mixin(parent, { children });
        }

        const children: Pipeline[] = [];

        for (let i = 0; i < parent.files.length; i++) {
          const child = FilesPipeline.mixin(
            {},
            {
              files: [parent.files[i]],
              commands: parent.commands,
            }
          );
          child.id = `${parent.id}_${i}`;
          children.push(child);
        }

        GroupPipeline.mixin(parent, { children });
      }

      if (InteractivePipeline.is(parent)) {
        for (const command of parent.commands) {
          if (command.type === "pull") {
            pipelines.push(command.pipeline);
          }
        }
      }

      if (GroupPipeline.is(parent)) {
        for (const child of parent.children) {
          pipelines.push(child);
        }
      }
    } while (pipelines.length);
  }
}
