export type ArrayOr<T> = T | T[];
export type MaybePromise<T> = T | Promise<T>;
export type QueryLike = string | string[];
export interface File {
  dirname: string;
  basename: string;
  content: string;
}
export type Transformer = (files: File[]) => MaybePromise<File[]>;
