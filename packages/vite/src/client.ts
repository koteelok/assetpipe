/**
 * Build-time macros over assetpipe pipeline outputs.
 *
 * `output.glob(pattern)` is statically replaced by the assetpipe Vite plugin
 * with an object literal mapping matched output paths to URLs:
 *
 * ```ts
 * import { output } from "@assetpipe/vite/client";
 *
 * const sprites = output.glob("/sprites/*.webp");
 * // { "/sprites/hero.webp": "/sprites/hero.webp?t=…" }   (dev)
 * // { "/sprites/hero.webp": "/assets/hero-D3x9q.webp" }  (build)
 * ```
 *
 * This is the assetpipe counterpart of `import.meta.glob`, which cannot see
 * pipeline outputs: it scans the real filesystem at transform time, while
 * pipeline outputs only exist behind the plugin's virtual resolution.
 *
 * Constraints (mirroring `import.meta.glob`):
 * - the pattern must be a string literal,
 * - `output` must be imported directly from "@assetpipe/vite/client".
 *
 * The runtime implementation below only exists to fail loudly when the
 * plugin did not perform the replacement.
 */
export interface PipelineOutput {
  /**
   * Map every pipeline output whose path matches `pattern` (picomatch
   * syntax, matched against `/`-prefixed output targets) to its URL.
   *
   * Replaced at transform time; never actually called.
   */
  glob(pattern: string): Record<string, string>;
}

export const output: PipelineOutput = {
  glob(pattern: string): never {
    throw new Error(
      `[assetpipe] output.glob(${JSON.stringify(pattern)}) was not replaced at build time. ` +
        "Add the assetpipe() plugin to your Vite config and pass the pattern as a string literal.",
    );
  },
};
