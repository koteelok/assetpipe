import path from "path";

function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  if (!child.startsWith(parent)) return false;
  return child[parent.length] === path.sep;
}

export function collapsePaths(files: Iterable<string>): string[] {
  const collapsed: string[] = [];

  filesLoop: for (const file of files) {
    const fileDirname = path.dirname(file);

    for (let i = 0; i < collapsed.length; i++) {
      if (isInside(fileDirname, collapsed[i])) {
        continue filesLoop;
      }
    }

    for (let i = collapsed.length - 1; i >= 0; i--) {
      if (isInside(collapsed[i], fileDirname)) {
        collapsed.splice(i, 1);
      }
    }

    collapsed.push(fileDirname);
  }

  return collapsed;
}
