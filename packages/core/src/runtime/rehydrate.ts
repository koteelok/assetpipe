import { File } from "../types";
import type { ExecutionMetadata } from "./options";

export function rehydrateFiles(files: readonly File[]): File[] {
  const out: File[] = new Array(files.length);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    out[i] = new File({ target: f.target, content: f.content });
  }
  return out;
}

export function rehydrateMetadata(metadata: ExecutionMetadata): ExecutionMetadata {
  return {
    addedFiles: rehydrateFiles(metadata.addedFiles),
    changedFiles: rehydrateFiles(metadata.changedFiles),
    removedFiles: rehydrateFiles(metadata.removedFiles),
    queryTriggers: metadata.queryTriggers,
  };
}
