import { posix } from "node:path";

import type { File } from "@assetpipe/core/types";

function _target(fileOrTarget: File | string) {
  return (fileOrTarget as File).target ? (fileOrTarget as File).target : (fileOrTarget as string);
}

function basename(file: File, ext?: string): string;
function basename(target: string, ext?: string): string;
function basename(fileOrTarget: File | string, ext?: string): string {
  return posix.basename(_target(fileOrTarget), ext);
}

function dirname(file: File): string;
function dirname(target: string): string;
function dirname(fileOrTarget: File | string): string {
  return posix.dirname(_target(fileOrTarget));
}

function extname(file: File): string;
function extname(target: string): string;
function extname(fileOrTarget: File | string): string {
  return posix.extname(_target(fileOrTarget));
}

function join(...parts: (File | string)[]): string {
  return posix.join(...parts.map(_target));
}

function rename(file: File, newBasename: string): string {
  return posix.join(posix.dirname(file.target), newBasename);
}

function move(file: File, newDirname: string): string {
  return posix.join(newDirname, posix.basename(file.target));
}

export const path = {
  basename,
  dirname,
  extname,
  join,
  rename,
  move,
};
