import { randomBytes } from "crypto";
import { defineConfig } from "tsdown";

const BUILD_ID_TOKEN = "__ASSETPIPE_BUILD_ID__";

export default defineConfig(() => {
  let buildId = "";

  return {
    entry: [
      "src/types.ts",
      "src/pipelines/index.ts",
      "src/runtime/index.ts",
      "src/runtime/worker/session.ts",
    ],
    hash: false,
    clean: true,
    dts: true,
    sourcemap: true,
    format: ["esm", "cjs"],
    plugins: [
      {
        name: "assetpipe-build-id",
        buildStart() {
          buildId = randomBytes(8).toString("hex");
        },
        transform(code) {
          if (!code.includes(BUILD_ID_TOKEN)) return null;
          return {
            code: code.replace(
              /(?<!declare\s+const\s+)__ASSETPIPE_BUILD_ID__/g,
              JSON.stringify(buildId),
            ),
            map: null,
          };
        },
      },
    ],
  };
});
