import { Pipeline, PipelineMixin } from "../pipelines/pipeline";

function cloneDeep(source: any, pipelineMap = new Map<Pipeline, Pipeline>()): any {  
  if (source && PipelineMixin.is(source)) {
    let clone = pipelineMap.get(source);
    if (clone) return clone;

    const mixin = source[PipelineMixin.mixinKey];
    const options: any = {};
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        // Skip mixin-related keys
        if (key.startsWith("$is")) continue;
        options[key] = cloneDeep(source[key], pipelineMap);
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
      arr.push(cloneDeep(value, pipelineMap));
    }
    return arr;
  }

  const obj: any = {};
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      obj[key] = cloneDeep(source[key], pipelineMap);
    }
  }
  return obj;
}

export function clonePipeline(value: Pipeline): Pipeline {
  return cloneDeep(value);
}
