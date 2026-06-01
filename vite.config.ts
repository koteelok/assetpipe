import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: "test/setupTests.ts",
    projects: [
      {
        extends: true,
        test: {
          name: "run",
          include: ["test/run/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "watch",
          include: ["test/watch/**/*.test.ts"],
          maxWorkers: 1,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
