import { run } from "@assetpipe/core/runtime";
import { readdir, readFile } from "fs/promises";
import { resolve } from "path";
import { expect, test } from "vitest";

test("query with groupBy: groups files by dirname and produces one bundle per group", async () => {
  const entry = resolve(__dirname, "pipeline.ts");
  const outputDirectory = resolve(__dirname, "output");

  await run({ entry, outputDirectory, queryBase: __dirname, useWorker: false });

  const resultFiles = await readdir(outputDirectory);
  expect(resultFiles).toContain("txt.bundle");
  expect(resultFiles).toContain("json.bundle");

  // txt bundle must contain all three text values (order may vary)
  const txtBundle = await readFile(
    resolve(outputDirectory, "txt.bundle"),
    "utf-8",
  );
  expect(txtBundle).toContain("alpha");
  expect(txtBundle).toContain("beta");
  expect(txtBundle).toContain("gamma");

  // json bundle must contain both json payloads
  const jsonBundle = await readFile(
    resolve(outputDirectory, "json.bundle"),
    "utf-8",
  );
  expect(jsonBundle).toContain('{"value":10}');
  expect(jsonBundle).toContain('{"value":20}');
});
