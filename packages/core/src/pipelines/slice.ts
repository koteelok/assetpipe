import type { File } from "../types";

export type Slice = {
  key: string;
  output: File[];
  dirty: boolean;
};
