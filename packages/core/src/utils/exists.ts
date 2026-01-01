import { stat } from "node:fs/promises";

export function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  );
}
