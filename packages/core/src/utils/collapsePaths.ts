import path from "path";

export function collapsePaths(files: Iterable<string>): string[] {
  const collapsed = [];

  filesLoop: for (const file of files) {
    const fileDirname = path.dirname(file);

    for (let i = 0; i < collapsed.length; i++) {
      const collapsedDir: string = collapsed[i];

      if (collapsedDir.startsWith(fileDirname)) {
        continue filesLoop;
      }

      if (fileDirname.startsWith(collapsedDir)) {
        collapsed[i] = fileDirname;
        continue filesLoop;
      }
    }

    collapsed.push(fileDirname);
  }

  return collapsed;
}
