import { randomUUID } from "crypto";

declare const CURRENT_TEMP_DIR: string | undefined;

export function tmpdir(): string {
  if (!CURRENT_TEMP_DIR) {
    throw new Error("tmpdir called outside of a pipeline");
  }

  return CURRENT_TEMP_DIR;
}

export function tmpfile(): string {
  if (!CURRENT_TEMP_DIR) {
    throw new Error("tmpfile called outside of a pipeline");
  }

  return `${CURRENT_TEMP_DIR}/${randomUUID()}`;
}
