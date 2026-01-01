import { File } from '../types';

export function cloneFiles(files: File[]): File[] {
  const clone: File[] = [];
  for (const file of files) {
    clone.push({
      basename: file.basename,
      dirname: file.dirname,
      content: file.content,
    });
  }
  return clone;
}
