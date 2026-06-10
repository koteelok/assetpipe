import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/exports.ts", "src/client.ts"],
  clean: true,
  dts: true,
  sourcemap: true,
  format: ["esm", "cjs"],
});
