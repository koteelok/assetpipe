import { createHash } from 'crypto';

export function shortHash(input: string, bytes = 16) {
  const hash = createHash("sha256").update(input).digest();
  return hash.subarray(0, bytes).toString("base64url");
}