import os from "node:os";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { ResearchEvidenceLedger } from "../src/gai/research-evidence-ledger.ts";
import { assessResearchProgram, nextExecutableResearchStages, type ResearchEvidence } from "../src/gai/research-ops-program.ts";

const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
const ledgerArg = process.argv.find((arg) => arg.startsWith("--ledger="));
const source = path.resolve(sourceArg?.slice(9) || ".gai-results/research-evidence.json");
const defaultLedger = process.platform === "win32"
  ? path.join(process.env.LOCALAPPDATA || os.homedir(), "GAIWorker", "research-evidence-ledger.json")
  : path.join(os.homedir(), "Library", "Application Support", "GAIWorker", "research-evidence-ledger.json");
const ledgerPath = path.resolve(ledgerArg?.slice(9) || process.env.GAI_RESEARCH_EVIDENCE_LEDGER || defaultLedger);

const incoming = JSON.parse(await readFile(source, "utf8")) as ResearchEvidence[];
if (!Array.isArray(incoming)) throw new Error("source evidence must be a JSON array");
const ledger = new ResearchEvidenceLedger(ledgerPath);
const merged = await ledger.merge(incoming);
const assessments = assessResearchProgram(merged);
const next = nextExecutableResearchStages(merged);
const status = {
  schemaVersion: 1,
  ledgerPath,
  evidenceCount: merged.length,
  completed: assessments.filter((item) => item.status === "complete").map((item) => item.stage),
  ready: next,
  blocked: assessments.filter((item) => item.status === "blocked").map((item) => item.stage),
  generatedAt: new Date().toISOString(),
};
await mkdir(path.resolve(".gai-results"), { recursive: true });
await writeFile(path.resolve(".gai-results/research-ledger-status.json"), JSON.stringify(status, null, 2));
console.log(JSON.stringify(status, null, 2));
