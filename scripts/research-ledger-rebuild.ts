import path from "node:path";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { ResearchEvidenceLedger } from "../src/gai/research-evidence-ledger.ts";
import { assessResearchProgram, nextExecutableResearchStages, type ResearchEvidence } from "../src/gai/research-ops-program.ts";

const rootArg = process.argv.find((arg) => arg.startsWith("--sources-root="));
const root = path.resolve(rootArg?.slice("--sources-root=".length) || ".gai-evidence-cache");
const outDir = path.resolve(".gai-results");
const ledgerPath = path.join(outDir, "research-evidence-ledger.json");

async function walk(dir: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && entry.name === "research-evidence.json") files.push(full);
  }
  return files;
}

const files = await walk(root);
const ledger = new ResearchEvidenceLedger(ledgerPath);
let acceptedFiles = 0;
let rejectedFiles = 0;
for (const file of files.sort()) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as ResearchEvidence[];
    if (!Array.isArray(parsed)) throw new Error("evidence must be array");
    await ledger.merge(parsed);
    acceptedFiles += 1;
  } catch (error) {
    rejectedFiles += 1;
    console.warn(`Ignoring invalid evidence file ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const merged = files.length ? JSON.parse(await readFile(ledgerPath, "utf8")) as ResearchEvidence[] : [];
const assessments = assessResearchProgram(merged);
const next = nextExecutableResearchStages(merged);
const status = {
  schemaVersion: 2,
  ledgerPath,
  sourceFilesDiscovered: files.length,
  acceptedFiles,
  rejectedFiles,
  evidenceCount: merged.length,
  completed: assessments.filter((item) => item.status === "complete").map((item) => item.stage),
  ready: next,
  blocked: assessments.filter((item) => item.status === "blocked").map((item) => item.stage),
  generatedAt: new Date().toISOString(),
};
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "research-ledger-status.json"), JSON.stringify(status, null, 2));
console.log(JSON.stringify(status, null, 2));
