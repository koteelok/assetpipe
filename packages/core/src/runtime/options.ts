import { File } from "../types";

export interface ExecutionMetadata {
  addedFiles: File[];
  changedFiles: File[];
  removedFiles: File[];
  queryTriggers: string[];
}

export interface AssetpipeOptions {
  entry: string;
  outputDirectory?: string;
  cacheDirectory?: string;
  /**
   * @default true
   */
  useWorker?: boolean;
  onOutput?: (files: File[], metadata?: ExecutionMetadata) => void;
}
