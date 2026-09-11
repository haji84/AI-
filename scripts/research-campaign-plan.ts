import { readFile } from "node:fs/promises";
import path from "node:path";
import { summarizeResearchProgram } from "../src/gai/research-campaign-orchestrator.ts";
import type { ResearchEvidence } from "../src/gai/research-ops-program.ts";

const evidenceArg = process.argv.find((arg) => arg.startsWith("--evidence="));
const evidencePath = path.resolve(evidenceArg?.slice(11) || ".gai-results/research-evidence.json");
let evidence: ResearchEvidence[] = [];
try {
  evidence = JSON.parse(await readFile(evidencePath, "utf8")) as ResearchEvidence[];
  if (!Array.isArray(evidence)) throw new Error("evidence file must be an array");
} catch (error) {
  if (process.argv.includes("--require-evidence")) throw error;
}
const snapshot = summarizeResearchProgram(evidence);
console.log(JSON.stringify({ evidencePath, ...snapshot, generatedAt: new Date().toISOString() }, null, 2));
