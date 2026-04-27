export function createPromise<T = void>() {
  const obj = {} as {
    resolved: boolean;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
    promise: Promise<T>;
    restart: () => void;
  };

  obj.restart = () => {
    obj.resolved = false;
    obj.promise = new Promise((res, rej) => {
      obj.resolve = (v) => {
        obj.resolved = true;
        return res(v);
      };
      obj.reject = rej;
    });
  };

  obj.restart();
  return obj;
}
