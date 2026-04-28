import { SetRequired } from "type-fest";
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
   * @default process.cwd()
   */
  queryBase?: string;
  /**
   * @default true
   */
  useWorker?: boolean;
  onOutput?: (files: File[], metadata?: ExecutionMetadata) => void;
}

export type AssetpipeOptionsWithDefaults = SetRequired<
  AssetpipeOptions,
  "queryBase" | "useWorker"
>;

export function applyDefaults(
  options: AssetpipeOptions,
): AssetpipeOptionsWithDefaults {
  return {
    queryBase: process.cwd(),
    useWorker: true,
    ...options,
  };
}
