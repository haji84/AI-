import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assessResearchProgram,
  evaluateAgiClaimGate,
  nextExecutableResearchStages,
  type ResearchEvidence,
} from "../src/gai/research-ops-program.ts";

const args = new Set(process.argv.slice(2));
const evidenceArg = process.argv.find((arg) => arg.startsWith("--evidence="));
const evidencePath = resolve(evidenceArg?.slice("--evidence=".length) || ".gai-results/research-evidence.json");

let evidence: ResearchEvidence[] = [];
try {
  const raw = await readFile(evidencePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("evidence file must contain a JSON array");
  evidence = parsed as ResearchEvidence[];
} catch (error) {
  if (args.has("--require-evidence")) throw error;
  console.error(`Research evidence unavailable at ${evidencePath}; reporting gates with empty evidence.`);
}

const assessments = assessResearchProgram(evidence);
const next = nextExecutableResearchStages(evidence);
const claimGate = evaluateAgiClaimGate({
  assessments,
  independentExternalValidation: false,
  unresolvedSafetyRegression: false,
  additionalPaygApiCost: 0,
});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  evidencePath,
  evidenceCount: evidence.length,
  completed: assessments.filter((item) => item.status === "complete").map((item) => item.stage),
  ready: next,
  blocked: assessments.filter((item) => item.status === "blocked").map((item) => item.stage),
  stages: assessments,
  agiClaimGate: claimGate,
};

console.log(JSON.stringify(report, null, 2));
