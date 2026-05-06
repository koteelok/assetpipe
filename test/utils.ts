import { Mock } from "vitest";

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
