# AssetPipe

AssetPipe is a first-of-its-kind asset pipeline framework for code-first projects.

> Status: work in progress. The API may change between versions.

## Why

In code-first projects, asset preparation tends to grow into a pile of ad-hoc
scripts: one to compress textures, another to pack sprite atlases, a third to copy
and rename things. They are slow to re-run, hard to keep in sync, and usually
recompute everything from scratch every time.

Major game engines avoid this by embedding asset management into the editor's
workflow itself, which lets them offer flexible options for asset optimization and
bundling.

But no all-in-one tool can cover every use case - workflows differ wildly across
custom engines, web games, and everything in between. So instead of shipping a fixed
tool, AssetPipe is a framework you build your own pipeline on top of. It's:

- **Declarative**: you describe the desired transformations, not the plumbing.
- **Cache-first**: the APIs are designed so your pipeline reuses as much prior
  compute as possible.
- **Incremental**: unchanged assets are skipped, and only what actually changed is
  recomputed.
- **Composable**: pipelines select files with globs and chain transformations,
  branching and merging as needed.
- **Watchable**: run it once, or leave it watching and have outputs update as
  source files change.

## How it looks

A pipeline is a small config file that picks up source files and runs them through
transformations. APIs look kinda like Gulp:

```ts
import { group, query } from "@assetpipe/config";
import { convertImage, texturePacker } from "@assetpipe/image";

export default group(
  // Pack everything under sprites/ into a texture atlas + data file.
  // `claim` takes ownership of these files so the query below skips them.
  query("sprites/**/*.png", { claim: true }).pipe(
    texturePacker({
      name: "sprites",
      maxWidth: 2048,
      imageFormat: { extension: "webp", quality: 90 },
      dataFormat: "TexturePacker",
    }),
  ),

  // Re-encode all remaining images as WebP, one at a time so each is cached
  // independently.
  query("**/*.{png,jpg}", { parallel: true }).pipe(
    convertImage({ extension: "webp", quality: 80 }),
  ),
);
```

You can drive a pipeline in a few ways:

- **CLI**: run a pipeline once or in watch mode and write the results to a folder.
- **Vite plugin**: run pipelines as part of dev and build, with outputs served by
  the dev server and importable directly from your code.
- **Programmatically**: call the runtime from your own scripts.

## Packages

This is an npm-workspaces monorepo:

| Package             | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `@assetpipe/core`   | Pipeline engine, runtime, caching, and the file model            |
| `@assetpipe/config` | The user-facing API for writing pipelines                        |
| `@assetpipe/cli`    | `assetpipe` command-line runner                                  |
| `@assetpipe/image`  | Image transformers (convert, trim, texture-pack), built on sharp |
| `@assetpipe/vite`   | Vite plugin for running pipelines during dev and build           |

## Development

```sh
npm install
npm run build      # build all packages (nx)
npm test           # run the vitest suite
npm run format     # prettier check
```

## License

Apache-2.0
