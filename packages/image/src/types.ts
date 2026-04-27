export type RequireKey<T, K extends keyof T> = Required<Pick<T, K>> &
  Omit<T, K>;

export type ArrayOr<T> = T | T[];

export type MaybePromise<T> = T | Promise<T>;
