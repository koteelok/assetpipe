import { File } from "../types";

export function cloneFiles(files: File[]) {
  const copyArray = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    copyArray.push({
      basename: file.basename,
      dirname: file.dirname,
      content: file.content,
    });
  }

  return copyArray;
}
