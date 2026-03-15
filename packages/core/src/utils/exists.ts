import { stat } from 'fs/promises';

export async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}