import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MANIFEST_SCHEMA, REPORT_SCHEMA, runBaseline } from "../scripts/gai-baseline-run.ts";

async function fixture(): Promise<{ dir: string; manifestPath: string; adapterPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "gai-baseline-"));
  const manifestPath = join(dir, "manifest.json");
  const adapterPath = join(dir, "adapter.mjs");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: MANIFEST_SCHEMA,
    suiteId: "fixture-v1",
    cases: [
      { id: "case-1", input: "alpha" },
      { id: "case-2", input: "beta" },
    ],
  }));
  await writeFile(adapterPath, `#!/usr/bin/env node
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  process.stdout.write(JSON.stringify({
    ok: request.case.id === "case-1",
    output: "fixture",
    modelTier: "local",
    provider: "fixture-local",
    additionalApiCost: 0,
    humanInterventionCount: 0,
    retryCount: 0,
    transferResult: null,
    failureTaxonomy: request.case.id === "case-1" ? null : "fixture_failure"
  }));
});
`);
  await chmod(adapterPath, 0o755);
  return { dir, manifestPath, adapterPath };
}

test("refuses to label CI/harness validation as a real baseline without an adapter", async () => {
  const report = await runBaseline({
    manifestPath: ".gai-research/benchmark-suite-v1.json",
    reportPath: ".gai-research/baseline-run.json",
    now: () => "2026-09-10T00:00:00.000Z",
  });

  assert.equal(report.schemaVersion, REPORT_SCHEMA);
  assert.equal(report.status, "blocked");
  assert.equal(report.realExecution, false);
  assert.equal(report.executedCases, 0);
  assert.equal(report.passedCases, null);
  assert.equal(report.successRate, null);
  assert.match(report.blocker ?? "", /No real model\/runtime adapter/);
  assert.match(report.resumeCommand, /^GAI_BASELINE_ADAPTER=/);
});

test("marks a report real only after an executable zero-cost adapter runs every manifest case", async () => {
  const { dir, manifestPath, adapterPath } = await fixture();
  const report = await runBaseline({
    manifestPath,
    reportPath: join(dir, "report.json"),
    adapterPath,
    now: () => "2026-09-10T00:00:00.000Z",
  });

  assert.equal(report.status, "real_baseline");
  assert.equal(report.realExecution, true);
  assert.equal(report.suiteId, "fixture-v1");
  assert.equal(report.totalCases, 2);
  assert.equal(report.executedCases, 2);
  assert.equal(report.passedCases, 1);
  assert.equal(report.successRate, 0.5);
  assert.deepEqual(report.results.map((item) => item.provider), ["fixture-local", "fixture-local"]);
  assert.equal(report.results[1]?.failureTaxonomy, "fixture_failure");
});

test("rejects an adapter that reports incremental API cost", async () => {
  const { dir, manifestPath, adapterPath } = await fixture();
  await writeFile(adapterPath, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(JSON.stringify({
  ok: true,
  output: "not allowed",
  modelTier: "frontier",
  provider: "paid-fixture",
  additionalApiCost: 1
})));
`);
  await chmod(adapterPath, 0o755);

  await assert.rejects(
    runBaseline({ manifestPath, reportPath: join(dir, "report.json"), adapterPath }),
    /non-zero additional API cost/,
  );
});
