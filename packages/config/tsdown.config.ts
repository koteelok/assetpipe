import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/exports.ts"],
  clean: true,
  dts: true,
  format: ["esm", "cjs"],
});
