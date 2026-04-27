import { stat } from "fs/promises";

export async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function existsFile(path: string) {
  return stat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );
}
