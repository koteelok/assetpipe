import { rm, utimes, writeFile } from "fs/promises";
import path from "path";
import { Mock } from "vitest";

// Forward-bump mtime so @parcel/watcher snapshot diffs reliably detect the
// change without depending on real wall-clock sleeps between writes and snapshots.
function bumpedTime(): Date {
  return new Date(Date.now() + 2000);
}

export async function touchFile(p: string, content: string): Promise<void> {
  await writeFile(p, content);
  const t = bumpedTime();
  await utimes(p, t, t);
}

export async function removeFile(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true });
  const t = bumpedTime();
  // Bump parent directory mtime so snapshot diffs see the deletion immediately.
  await utimes(path.dirname(p), t, t);
}

export function waitForCalls<T extends (...args: any[]) => any>(
  spy: Mock<T>,
  callCount: number,
  timeout = 10_000,
) {
  return new Promise<Parameters<T>>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out waiting for console.log call #${callCount}. Got ${spy.mock.calls.length} call(s).`,
          ),
        ),
      timeout,
    );

    const check = () => {
      if (spy.mock.calls.length >= callCount) {
        clearTimeout(timer);
        resolve(spy.mock.calls[callCount - 1] as Parameters<T>);
      } else {
        setTimeout(check, 50);
      }
    };

    check();
  });
}
