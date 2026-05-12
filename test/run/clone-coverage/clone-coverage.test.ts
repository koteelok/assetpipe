import { run } from "@assetpipe/core/runtime";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("clone-coverage", () => {
  const baseDir = __dirname;
  const assetsDir = resolve(baseDir, "assets");
  const cacheDir = resolve(baseDir, "cache");
  const outputDir = resolve(baseDir, "output");
  const counterDir = resolve(baseDir, "counters");

  beforeEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterDir, { recursive: true, force: true });
    await mkdir(assetsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
    await rm(outputDir, { recursive: true, force: true });
    await rm(counterDir, { recursive: true, force: true });
  });

  async function getCounters() {
    try {
      const files = await readdir(counterDir);
      const result: Record<string, number> = {};
      for (const f of files) {
        result[f.replace(".json", "")] = JSON.parse(
          await readFile(resolve(counterDir, f), "utf-8"),
        );
      }
      return result;
    } catch {
      return {};
    }
  }

  async function runPipeline(entry: string) {
    await run({
      entry: resolve(baseDir, entry),
      outputDirectory: outputDir,
      cacheDirectory: cacheDir,
      queryBase: baseDir,
      useWorker: false,
    });
  }

  async function modify(relativePath: string, content: string) {
    await new Promise((r) => setTimeout(r, 100));
    await writeFile(resolve(assetsDir, relativePath), content);
    await new Promise((r) => setTimeout(r, 100));
  }

  test("deep chain (4 levels): per-file slice cache survives many runs and modifications", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");
    await writeFile(resolve(assetsDir, "c.txt"), "gamma");

    // Run 1 — initial, every level runs once per file.
    await runPipeline("pipeline-deep-chain.ts");

    expect((await readdir(outputDir)).sort()).toEqual([
      "a.txt.out",
      "b.txt.out",
      "c.txt.out",
    ]);
    expect(await readFile(resolve(outputDir, "a.txt.out"), "utf-8")).toBe(
      "ALPHA/1/2/3",
    );
    expect(await readFile(resolve(outputDir, "b.txt.out"), "utf-8")).toBe(
      "BETA/1/2/3",
    );
    expect(await getCounters()).toEqual({
      "source-a.txt": 1,
      "source-b.txt": 1,
      "source-c.txt": 1,
      "c1-a.txt": 1,
      "c1-b.txt": 1,
      "c1-c.txt": 1,
      "c2-a.txt": 1,
      "c2-b.txt": 1,
      "c2-c.txt": 1,
      "c3-a.txt": 1,
      "c3-b.txt": 1,
      "c3-c.txt": 1,
    });

    // Run 2 — no changes; nothing should re-run at any level.
    await runPipeline("pipeline-deep-chain.ts");
    expect(await getCounters()).toEqual({
      "source-a.txt": 1,
      "source-b.txt": 1,
      "source-c.txt": 1,
      "c1-a.txt": 1,
      "c1-b.txt": 1,
      "c1-c.txt": 1,
      "c2-a.txt": 1,
      "c2-b.txt": 1,
      "c2-c.txt": 1,
      "c3-a.txt": 1,
      "c3-b.txt": 1,
      "c3-c.txt": 1,
    });

    // Run 3 — change a.txt; only the `a` slice should re-run at every level.
    await modify("a.txt", "alpha-changed");
    await runPipeline("pipeline-deep-chain.ts");
    expect(await readFile(resolve(outputDir, "a.txt.out"), "utf-8")).toBe(
      "ALPHA-CHANGED/1/2/3",
    );
    expect(await readFile(resolve(outputDir, "b.txt.out"), "utf-8")).toBe(
      "BETA/1/2/3",
    );
    expect(await getCounters()).toEqual({
      "source-a.txt": 2,
      "source-b.txt": 1,
      "source-c.txt": 1,
      "c1-a.txt": 2,
      "c1-b.txt": 1,
      "c1-c.txt": 1,
      "c2-a.txt": 2,
      "c2-b.txt": 1,
      "c2-c.txt": 1,
      "c3-a.txt": 2,
      "c3-b.txt": 1,
      "c3-c.txt": 1,
    });

    // Run 4 — no changes since run 3; cache should be sticky after invalidation.
    await runPipeline("pipeline-deep-chain.ts");
    expect(await getCounters()).toEqual({
      "source-a.txt": 2,
      "source-b.txt": 1,
      "source-c.txt": 1,
      "c1-a.txt": 2,
      "c1-b.txt": 1,
      "c1-c.txt": 1,
      "c2-a.txt": 2,
      "c2-b.txt": 1,
      "c2-c.txt": 1,
      "c3-a.txt": 2,
      "c3-b.txt": 1,
      "c3-c.txt": 1,
    });

    // Run 5 — change b.txt; only `b` invalidates, `a` stays at its prior count.
    await modify("b.txt", "beta-changed");
    await runPipeline("pipeline-deep-chain.ts");
    expect(await readFile(resolve(outputDir, "b.txt.out"), "utf-8")).toBe(
      "BETA-CHANGED/1/2/3",
    );
    expect(await getCounters()).toEqual({
      "source-a.txt": 2,
      "source-b.txt": 2,
      "source-c.txt": 1,
      "c1-a.txt": 2,
      "c1-b.txt": 2,
      "c1-c.txt": 1,
      "c2-a.txt": 2,
      "c2-b.txt": 2,
      "c2-c.txt": 1,
      "c3-a.txt": 2,
      "c3-b.txt": 2,
      "c3-c.txt": 1,
    });

    // Run 6 — change a.txt again; verify successive modifications keep working.
    await modify("a.txt", "alpha-third");
    await runPipeline("pipeline-deep-chain.ts");
    expect(await readFile(resolve(outputDir, "a.txt.out"), "utf-8")).toBe(
      "ALPHA-THIRD/1/2/3",
    );
    expect(await getCounters()).toEqual({
      "source-a.txt": 3,
      "source-b.txt": 2,
      "source-c.txt": 1,
      "c1-a.txt": 3,
      "c1-b.txt": 2,
      "c1-c.txt": 1,
      "c2-a.txt": 3,
      "c2-b.txt": 2,
      "c2-c.txt": 1,
      "c3-a.txt": 3,
      "c3-b.txt": 2,
      "c3-c.txt": 1,
    });
  });

  test("bare .clone().clone().clone(): extra clone layers without pipe don't multiply source work", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");

    // Run 1 — fresh.
    await runPipeline("pipeline-bare-chain.ts");
    expect((await readdir(outputDir)).sort()).toEqual([
      "a.txt.out",
      "b.txt.out",
    ]);
    expect(await readFile(resolve(outputDir, "a.txt.out"), "utf-8")).toBe(
      "ALPHA/triple",
    );
    expect(await readFile(resolve(outputDir, "b.txt.out"), "utf-8")).toBe(
      "BETA/triple",
    );
    expect(await getCounters()).toEqual({
      "source-a.txt": 1,
      "source-b.txt": 1,
      "final-a.txt": 1,
      "final-b.txt": 1,
    });

    // Run 2 — no changes; everything cache-hits.
    await runPipeline("pipeline-bare-chain.ts");
    expect(await getCounters()).toEqual({
      "source-a.txt": 1,
      "source-b.txt": 1,
      "final-a.txt": 1,
      "final-b.txt": 1,
    });

    // Run 3 — modify a.txt; only a-slice invalidates.
    await modify("a.txt", "alpha-2");
    await runPipeline("pipeline-bare-chain.ts");
    expect(await readFile(resolve(outputDir, "a.txt.out"), "utf-8")).toBe(
      "ALPHA-2/triple",
    );
    expect(await getCounters()).toEqual({
      "source-a.txt": 2,
      "source-b.txt": 1,
      "final-a.txt": 2,
      "final-b.txt": 1,
    });

    // Run 4 — no changes after invalidation; cache must remain sticky.
    await runPipeline("pipeline-bare-chain.ts");
    expect(await getCounters()).toEqual({
      "source-a.txt": 2,
      "source-b.txt": 1,
      "final-a.txt": 2,
      "final-b.txt": 1,
    });

    // Run 5 — modify b.txt; only b-slice invalidates.
    await modify("b.txt", "beta-2");
    await runPipeline("pipeline-bare-chain.ts");
    expect(await readFile(resolve(outputDir, "b.txt.out"), "utf-8")).toBe(
      "BETA-2/triple",
    );
    expect(await getCounters()).toEqual({
      "source-a.txt": 2,
      "source-b.txt": 2,
      "final-a.txt": 2,
      "final-b.txt": 2,
    });
  });

  test("multifork: 3 clones of source + 2 clones-of-clone share source work and cache per-file", async () => {
    await writeFile(resolve(assetsDir, "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "b.txt"), "beta");
    await writeFile(resolve(assetsDir, "c.txt"), "gamma");

    function expectedCounters(counts: Record<string, number>) {
      const result: Record<string, number> = {};
      for (const file of ["a.txt", "b.txt", "c.txt"]) {
        const k = counts[file];
        result["source-" + file] = k;
        result["cA-" + file] = k;
        result["cB-" + file] = k;
        result["cC-" + file] = k;
        result["cAA-" + file] = k;
        result["cAB-" + file] = k;
      }
      return result;
    }

    // Run 1 — initial; every fork runs once per file.
    await runPipeline("pipeline-multifork.ts");
    async function listAllOutputs() {
      const tags = (await readdir(outputDir)).sort();
      const out: string[] = [];
      for (const tag of tags) {
        const files = await readdir(resolve(outputDir, tag));
        for (const f of files) out.push(tag + "/" + f);
      }
      return out.sort();
    }
    expect(await listAllOutputs()).toEqual(
      [
        "cA/a.txt",
        "cA/b.txt",
        "cA/c.txt",
        "cAA/a.txt",
        "cAA/b.txt",
        "cAA/c.txt",
        "cAB/a.txt",
        "cAB/b.txt",
        "cAB/c.txt",
        "cB/a.txt",
        "cB/b.txt",
        "cB/c.txt",
        "cC/a.txt",
        "cC/b.txt",
        "cC/c.txt",
      ].sort(),
    );
    expect(await readFile(resolve(outputDir, "cA/a.txt"), "utf-8")).toBe(
      "ALPHA/cA",
    );
    expect(await readFile(resolve(outputDir, "cAA/a.txt"), "utf-8")).toBe(
      "ALPHA/cA/cAA",
    );
    expect(await readFile(resolve(outputDir, "cAB/a.txt"), "utf-8")).toBe(
      "ALPHA/cA/cAB",
    );
    expect(await getCounters()).toEqual(
      expectedCounters({ "a.txt": 1, "b.txt": 1, "c.txt": 1 }),
    );

    // Run 2 — no changes; no fork re-runs.
    await runPipeline("pipeline-multifork.ts");
    expect(await getCounters()).toEqual(
      expectedCounters({ "a.txt": 1, "b.txt": 1, "c.txt": 1 }),
    );

    // Run 3 — modify a.txt; every fork's a-slice re-runs once, b/c untouched.
    await modify("a.txt", "alpha-2");
    await runPipeline("pipeline-multifork.ts");
    expect(await readFile(resolve(outputDir, "cA/a.txt"), "utf-8")).toBe(
      "ALPHA-2/cA",
    );
    expect(await readFile(resolve(outputDir, "cAA/a.txt"), "utf-8")).toBe(
      "ALPHA-2/cA/cAA",
    );
    expect(await getCounters()).toEqual(
      expectedCounters({ "a.txt": 2, "b.txt": 1, "c.txt": 1 }),
    );

    // Run 4 — no changes; cache is still sticky.
    await runPipeline("pipeline-multifork.ts");
    expect(await getCounters()).toEqual(
      expectedCounters({ "a.txt": 2, "b.txt": 1, "c.txt": 1 }),
    );

    // Run 5 — modify c.txt; c-slice re-runs everywhere, a/b stay.
    await modify("c.txt", "gamma-2");
    await runPipeline("pipeline-multifork.ts");
    expect(await readFile(resolve(outputDir, "cC/c.txt"), "utf-8")).toBe(
      "GAMMA-2/cC",
    );
    expect(await getCounters()).toEqual(
      expectedCounters({ "a.txt": 2, "b.txt": 1, "c.txt": 2 }),
    );
  });

  test("clone of a group pipeline: clone() must work on GroupPipeline, not just QueryPipeline", async () => {
    await mkdir(resolve(assetsDir, "left"), { recursive: true });
    await mkdir(resolve(assetsDir, "right"), { recursive: true });
    await writeFile(resolve(assetsDir, "left", "x.txt"), "x");
    await writeFile(resolve(assetsDir, "left", "y.txt"), "y");
    await writeFile(resolve(assetsDir, "right", "p.txt"), "p");
    await writeFile(resolve(assetsDir, "right", "q.txt"), "q");

    // Run 1 — initial; each query runs once per file, the group clone runs
    // its post-merge command once.
    await runPipeline("pipeline-group-clone.ts");
    expect(await readdir(outputDir)).toEqual(["merged.txt"]);
    expect(await readFile(resolve(outputDir, "merged.txt"), "utf-8")).toBe(
      "p.txt=P,q.txt=Q,x.txt=X,y.txt=Y",
    );
    expect(await getCounters()).toEqual({
      "left-x.txt": 1,
      "left-y.txt": 1,
      "right-p.txt": 1,
      "right-q.txt": 1,
      "group-clone": 1,
    });

    // Run 2 — no changes; nothing re-runs.
    await runPipeline("pipeline-group-clone.ts");
    expect(await getCounters()).toEqual({
      "left-x.txt": 1,
      "left-y.txt": 1,
      "right-p.txt": 1,
      "right-q.txt": 1,
      "group-clone": 1,
    });

    // Run 3 — modify left/x.txt; only that query re-runs for x, group-clone
    // re-runs because its source's merged output changed.
    await modify("left/x.txt", "x2");
    await runPipeline("pipeline-group-clone.ts");
    expect(await readFile(resolve(outputDir, "merged.txt"), "utf-8")).toBe(
      "p.txt=P,q.txt=Q,x.txt=X2,y.txt=Y",
    );
    expect(await getCounters()).toEqual({
      "left-x.txt": 2,
      "left-y.txt": 1,
      "right-p.txt": 1,
      "right-q.txt": 1,
      "group-clone": 2,
    });

    // Run 4 — modify right/p.txt; group-clone re-runs again.
    await modify("right/p.txt", "p2");
    await runPipeline("pipeline-group-clone.ts");
    expect(await readFile(resolve(outputDir, "merged.txt"), "utf-8")).toBe(
      "p.txt=P2,q.txt=Q,x.txt=X2,y.txt=Y",
    );
    expect(await getCounters()).toEqual({
      "left-x.txt": 2,
      "left-y.txt": 1,
      "right-p.txt": 2,
      "right-q.txt": 1,
      "group-clone": 3,
    });

    // Run 5 — no changes after several rounds; cache is sticky end-to-end.
    await runPipeline("pipeline-group-clone.ts");
    expect(await getCounters()).toEqual({
      "left-x.txt": 2,
      "left-y.txt": 1,
      "right-p.txt": 2,
      "right-q.txt": 1,
      "group-clone": 3,
    });
  });

  test("clone of a ContextPipeline: clone() must work on Context, not just Query/Group", async () => {
    await mkdir(resolve(assetsDir, "nested"), { recursive: true });
    await writeFile(resolve(assetsDir, "nested", "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "nested", "b.txt"), "beta");

    // Run 1 — context resolves child query under "assets/nested", inner runs
    // per-file, ctx-clone runs once on the merged context result.
    await runPipeline("pipeline-context-clone.ts");
    expect(await readdir(outputDir)).toEqual(["ctx-out.txt"]);
    expect(await readFile(resolve(outputDir, "ctx-out.txt"), "utf-8")).toBe(
      "a.txt=ALPHA,b.txt=BETA",
    );
    expect(await getCounters()).toEqual({
      "inner-a.txt": 1,
      "inner-b.txt": 1,
      "ctx-clone": 1,
    });

    // Run 2 — no changes; everything cache-hits.
    await runPipeline("pipeline-context-clone.ts");
    expect(await getCounters()).toEqual({
      "inner-a.txt": 1,
      "inner-b.txt": 1,
      "ctx-clone": 1,
    });

    // Run 3 — modify nested/a.txt; inner re-runs for a, context's merged
    // result changes, so the clone's post-merge step re-runs.
    await modify("nested/a.txt", "alpha-2");
    await runPipeline("pipeline-context-clone.ts");
    expect(await readFile(resolve(outputDir, "ctx-out.txt"), "utf-8")).toBe(
      "a.txt=ALPHA-2,b.txt=BETA",
    );
    expect(await getCounters()).toEqual({
      "inner-a.txt": 2,
      "inner-b.txt": 1,
      "ctx-clone": 2,
    });

    // Run 4 — no changes after invalidation; sticky cache.
    await runPipeline("pipeline-context-clone.ts");
    expect(await getCounters()).toEqual({
      "inner-a.txt": 2,
      "inner-b.txt": 1,
      "ctx-clone": 2,
    });

    // Run 5 — modify nested/b.txt; b's inner re-runs, clone re-runs.
    await modify("nested/b.txt", "beta-2");
    await runPipeline("pipeline-context-clone.ts");
    expect(await readFile(resolve(outputDir, "ctx-out.txt"), "utf-8")).toBe(
      "a.txt=ALPHA-2,b.txt=BETA-2",
    );
    expect(await getCounters()).toEqual({
      "inner-a.txt": 2,
      "inner-b.txt": 2,
      "ctx-clone": 3,
    });
  });

  test("clone of a source that has .pull() in its commands", async () => {
    await mkdir(resolve(assetsDir, "main"), { recursive: true });
    await mkdir(resolve(assetsDir, "extras"), { recursive: true });
    await writeFile(resolve(assetsDir, "main", "a.txt"), "alpha");
    await writeFile(resolve(assetsDir, "main", "b.txt"), "beta");
    await writeFile(resolve(assetsDir, "extras", "e1.txt"), "e1");
    await writeFile(resolve(assetsDir, "extras", "e2.txt"), "e2");

    // Run 1 — extras runs once, source runs once (consumes main + pulled
    // extras), cloned wraps source's output once.
    await runPipeline("pipeline-clone-with-pull-source.ts");
    expect(await readdir(outputDir)).toEqual(["wrapped.txt"]);
    expect(await readFile(resolve(outputDir, "wrapped.txt"), "utf-8")).toBe(
      "[a.txt=alpha,b.txt=beta,extras.bundle=e1|e2]",
    );
    expect(await getCounters()).toEqual({
      extras: 1,
      source: 1,
      cloned: 1,
    });

    // Run 2 — no changes; everything cache-hits.
    await runPipeline("pipeline-clone-with-pull-source.ts");
    expect(await getCounters()).toEqual({
      extras: 1,
      source: 1,
      cloned: 1,
    });

    // Run 3 — modify a file inside the pulled query; the pull is dirty,
    // source re-runs (its pre-pull state is fine but post-pull is stale),
    // clone re-runs because source's result changed.
    await modify("extras/e1.txt", "e1-updated");
    await runPipeline("pipeline-clone-with-pull-source.ts");
    expect(await readFile(resolve(outputDir, "wrapped.txt"), "utf-8")).toBe(
      "[a.txt=alpha,b.txt=beta,extras.bundle=e1-updated|e2]",
    );
    expect(await getCounters()).toEqual({
      extras: 2,
      source: 2,
      cloned: 2,
    });

    // Run 4 — no changes; sticky cache holds for both source and clone.
    await runPipeline("pipeline-clone-with-pull-source.ts");
    expect(await getCounters()).toEqual({
      extras: 2,
      source: 2,
      cloned: 2,
    });

    // Run 5 — modify a main-side file; extras stays cached, source re-runs,
    // clone re-runs.
    await modify("main/a.txt", "alpha-2");
    await runPipeline("pipeline-clone-with-pull-source.ts");
    expect(await readFile(resolve(outputDir, "wrapped.txt"), "utf-8")).toBe(
      "[a.txt=alpha-2,b.txt=beta,extras.bundle=e1-updated|e2]",
    );
    expect(await getCounters()).toEqual({
      extras: 2,
      source: 3,
      cloned: 3,
    });
  });

  test("group clone chain: group(...).clone().pipe().clone().pipe().clone().pipe()", async () => {
    await mkdir(resolve(assetsDir, "left"), { recursive: true });
    await mkdir(resolve(assetsDir, "right"), { recursive: true });
    await writeFile(resolve(assetsDir, "left", "x.txt"), "x");
    await writeFile(resolve(assetsDir, "left", "y.txt"), "y");
    await writeFile(resolve(assetsDir, "right", "p.txt"), "p");
    await writeFile(resolve(assetsDir, "right", "q.txt"), "q");

    // Run 1 — each layer runs exactly once.
    await runPipeline("pipeline-group-clone-chain.ts");
    expect(await readdir(outputDir)).toEqual(["step3.txt"]);
    expect(await readFile(resolve(outputDir, "step3.txt"), "utf-8")).toBe(
      "<P,Q,X,Y>!",
    );
    expect(await getCounters()).toEqual({
      "left-x.txt": 1,
      "left-y.txt": 1,
      "right-p.txt": 1,
      "right-q.txt": 1,
      step1: 1,
      step2: 1,
      step3: 1,
    });

    // Run 2 — no changes.
    await runPipeline("pipeline-group-clone-chain.ts");
    expect(await getCounters()).toEqual({
      "left-x.txt": 1,
      "left-y.txt": 1,
      "right-p.txt": 1,
      "right-q.txt": 1,
      step1: 1,
      step2: 1,
      step3: 1,
    });

    // Run 3 — modify left/x.txt; left-x re-runs, every step in the clone
    // chain must re-run because each step's input depends on the prior step.
    await modify("left/x.txt", "x2");
    await runPipeline("pipeline-group-clone-chain.ts");
    expect(await readFile(resolve(outputDir, "step3.txt"), "utf-8")).toBe(
      "<P,Q,X2,Y>!",
    );
    expect(await getCounters()).toEqual({
      "left-x.txt": 2,
      "left-y.txt": 1,
      "right-p.txt": 1,
      "right-q.txt": 1,
      step1: 2,
      step2: 2,
      step3: 2,
    });

    // Run 4 — no changes; chain stays cached at every step.
    await runPipeline("pipeline-group-clone-chain.ts");
    expect(await getCounters()).toEqual({
      "left-x.txt": 2,
      "left-y.txt": 1,
      "right-p.txt": 1,
      "right-q.txt": 1,
      step1: 2,
      step2: 2,
      step3: 2,
    });

    // Run 5 — modify a file on the other side; same propagation.
    await modify("right/q.txt", "q2");
    await runPipeline("pipeline-group-clone-chain.ts");
    expect(await readFile(resolve(outputDir, "step3.txt"), "utf-8")).toBe(
      "<P,Q2,X2,Y>!",
    );
    expect(await getCounters()).toEqual({
      "left-x.txt": 2,
      "left-y.txt": 1,
      "right-p.txt": 1,
      "right-q.txt": 2,
      step1: 3,
      step2: 3,
      step3: 3,
    });
  });
});
