import { posix } from "node:path";

export type ArrayOr<T> = T | T[];
export type MaybePromise<T> = T | Promise<T>;
export type QueryLike = string | string[];

export class File {
  /**
   * The file's POSIX-style path relative to the pipeline output root
   * (forward slashes, no leading slash). This is the canonical identity
   * of the file — `basename`, `dirname`, and `extname` are all derived
   * from it.
   *
   * @example "sprites/hero.png"
   */
  readonly target: string;

  /**
   * Absolute filesystem path to the file's contents on disk. Use this
   * with `fs` APIs to read the actual bytes; it is unrelated to where
   * the file will end up in the pipeline output.
   *
   * @example "/tmp/assetpipe-xyz/abc123.png"
   */
  readonly content: string;

  /**
   * The filename portion of `target`, including the extension.
   * Derived from `target` via `posix.parse`.
   *
   * @example "hero.png"
   */
  readonly basename: string;

  /**
   * The directory portion of `target` (everything before the final
   * separator), or `""` if the file sits at the root. Derived from
   * `target` via `posix.parse`.
   *
   * @example "sprites"
   */
  readonly dirname: string;

  /**
   * The extension of `basename`, including the leading dot, or `""`
   * if there is none. Derived from `target` via `posix.parse`.
   *
   * @example ".png"
   */
  readonly extname: string;

  constructor(target: string, content: string) {
    this.target = target;
    this.content = content;
    const parsed = posix.parse(target);
    this.basename = parsed.base;
    this.dirname = parsed.dir;
    this.extname = parsed.ext;
  }

  withTarget(target: string): File {
    return new File(target, this.content);
  }

  withContent(content: string): File {
    return new File(this.target, content);
  }

  withBasename(basename: string): File {
    return new File(posix.join(this.dirname, basename), this.content);
  }

  withDirname(dirname: string): File {
    return new File(posix.join(dirname, this.basename), this.content);
  }

  withExtname(extname: string): File {
    const stem = this.basename.slice(
      0,
      this.basename.length - this.extname.length,
    );
    return new File(posix.join(this.dirname, stem + extname), this.content);
  }

  toJSON() {
    return { target: this.target, content: this.content };
  }
}

export type Transformer = (
  files: readonly File[],
) => MaybePromise<readonly File[]>;
