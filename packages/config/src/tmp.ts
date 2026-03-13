import type { PipelineCache } from "@assetpipe/core/runtime";
import { randomUUID } from "crypto";
import { tmpdir as osTempDir } from "os";

declare const CURRENT_CACHE: PipelineCache | undefined;

export function tmpdir(): string {
  return CURRENT_CACHE?.tempFilesPath ?? osTempDir();
}

export function tmpfile(): string {
  return `${tmpdir()}/${randomUUID()}`;
}
