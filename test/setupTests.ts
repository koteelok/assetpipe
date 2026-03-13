import { expect } from "vitest";

function consistsOf(source: string, reference: string): boolean {
  if (source.length !== reference.length) return false;

  const freq: Record<string, number> = {};
  let global = 0;

  for (const char of reference) {
    freq[char] ??= 0;
    freq[char]++;
    global++;
  }

  for (const char of source) {
    const count = freq[char];
    if (count === 0) return false;
    freq[char]--;
    global--;
  }

  return global === 0;
}

expect.extend({
  toConsistOf(received, expected) {
    const { isNot } = this;
    return {
      pass: consistsOf(received, expected),
      message: () =>
        `${received} does${isNot ? " not" : ""} consist of ${expected}`,
    };
  },
});

/* eslint-disable @typescript-eslint/no-unused-vars */
declare module "vitest" {
  interface Matchers<T> {
    toConsistOf: (reference: string) => void;
  }
}
