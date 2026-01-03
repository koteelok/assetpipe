import { readdir } from "node:fs/promises";
import path from "node:path";

import picomatch from "picomatch";

import { exists } from "../utils/exists";
import { IgnorePipeline, QueryPipeline } from "../pipelines";
import { File } from "../types";

export async function executeQuery(pipeline: QueryPipeline | IgnorePipeline) {
  const files: File[] = [];
  const queryArray: string[] = [];

  if (Array.isArray(pipeline.query)) {
    queryArray.push(...pipeline.query);
  } else {
    queryArray.push(pipeline.query);
  }

  for (const query of queryArray) {
    const state = picomatch.scan(
      path.join(pipeline.context, query).replace(/\\/g, "/")
    );
    const basePath = path.resolve(process.cwd(), state.base);

    if (state.glob === "") {
      if (!(await exists(basePath))) {
        throw new Error(`[${query}] Query error. File ${basePath} not found.`);
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

    if (dirents.length === 0) return [];

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

  return files;
}
