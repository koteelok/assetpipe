import type { Pipeline } from "../pipelines/pipeline";
import { PipelineMixin } from "../pipelines/pipeline";
import { File } from "../types";

function clonePipelineDeep(
  source: any,
  pipelineMap = new Map<Pipeline, Pipeline>(),
): any {
  if (source && PipelineMixin.is(source)) {
    let clone = pipelineMap.get(source);
    if (clone) return clone;

    const mixin = source[PipelineMixin.mixinKey];
    const options: any = {};
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        // Skip mixin-related keys
        if (key.startsWith("$is")) continue;
        options[key] = clonePipelineDeep(source[key], pipelineMap);
      }
    }
    clone = mixin.mix({}, options);
    pipelineMap.set(source, clone);
    return clone;
  }

  if (source === null || typeof source !== "object") {
    return source;
  }

  if (Array.isArray(source)) {
    const arr = [];
    for (const value of source) {
      arr.push(clonePipelineDeep(value, pipelineMap));
    }
    return arr;
  }

  const obj: any = {};
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      obj[key] = clonePipelineDeep(source[key], pipelineMap);
    }
  }
  return obj;
}

export function clonePipeline(value: Pipeline): Pipeline {
  return clonePipelineDeep(value);
}

export function cloneFiles(files: File[]) {
  const copyArray = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    copyArray.push({
      basename: file.basename,
      dirname: file.dirname,
      content: file.content,
    });
  }

  return copyArray;
}
