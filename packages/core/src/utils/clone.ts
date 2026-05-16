import { File } from "../types";

export function cloneFiles(files: File[]) {
  const copyArray = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    copyArray.push({
      target: file.target,
      content: file.content,
    });
  }

  return copyArray;
}
