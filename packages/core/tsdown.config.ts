import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/types.ts", "src/pipelines/index.ts", "src/runtime/executor.ts"],
  clean: true,
  dts: true,
  format: ["esm", "cjs"],
});
