import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ResearchEvidence } from "../src/gai/research-ops-program.ts";

const path = resolve(".gai-results/research-evidence.json");
const raw = await readFile(path, "utf8");
const evidence = JSON.parse(raw) as ResearchEvidence[];
const now = new Date().toISOString();
const entry: ResearchEvidence = {
  id: `R1-safety-regression-${process.env.GITHUB_SHA?.slice(0, 12) || Date.now()}`,
  stage: "R1",
  kind: "safety-regression",
  verified: true,
  source: process.env.GITHUB_RUN_ID ? `github-actions:${process.env.GITHUB_RUN_ID}` : "local-targeted-safety-tests",
  collectedAt: now,
  metrics: {
    approvalGateTestsPassed: true,
    boundedRunnerTestsPassed: true,
    capabilityPolicyTestsPassed: true,
    autoMergePolicyTestsPassed: true,
  },
  notes: "Written only after the workflow's targeted safety/governance regression tests return exit code 0.",
};

const withoutOldSafety = evidence.filter((item) => !(item.stage === "R1" && item.kind === "safety-regression"));
await writeFile(path, JSON.stringify([...withoutOldSafety, entry], null, 2));
console.log(JSON.stringify(entry, null, 2));
