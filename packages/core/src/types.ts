import { posix } from "node:path";

export type ArrayOr<T> = T | T[];
export type MaybePromise<T> = T | Promise<T>;
export type QueryLike = string | string[];

export type FileOptions =
  | {
      content: string;
      target: string;
      basename?: never;
      dirname?: never;
      extname?: never;
    }
  | {
      content: string;
      basename: string;
      dirname?: string;
      extname?: string;
      target?: never;
    };

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

  constructor(options: FileOptions) {
    let target: string;
    if (options.target !== undefined) {
      target = options.target;
    } else {
      const dir = options.dirname ?? "";
      let base = options.basename;
      if (options.extname !== undefined) {
        const stem = base.slice(0, base.length - posix.parse(base).ext.length);
        base = stem + options.extname;
      }
      target = dir ? posix.join(dir, base) : base;
    }
    this.target = target;
    this.content = options.content;
    const parsed = posix.parse(target);
    this.basename = parsed.base;
    this.dirname = parsed.dir;
    this.extname = parsed.ext;
  }

  withTarget(target: string): File {
    return new File({ target, content: this.content });
  }

  withContent(content: string): File {
    return new File({ target: this.target, content });
  }

  withBasename(basename: string): File {
    return new File({ basename, dirname: this.dirname, content: this.content });
  }

  withDirname(dirname: string): File {
    return new File({ basename: this.basename, dirname, content: this.content });
  }

  withExtname(extname: string): File {
    return new File({
      basename: this.basename,
      dirname: this.dirname,
      extname,
      content: this.content,
    });
  }

  toJSON() {
    return { target: this.target, content: this.content };
  }
}

export type Transformer = (
  files: readonly File[],
) => MaybePromise<readonly File[]>;
