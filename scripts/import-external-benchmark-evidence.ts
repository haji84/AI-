import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { validateExternalBenchmarkRun, type ExternalBenchmarkRun } from "../src/gai/external-benchmark-evidence.ts";
import type { ResearchEvidence } from "../src/gai/research-ops-program.ts";

const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
const stageArg = process.argv.find((arg) => arg.startsWith("--stage="));
if (!fileArg || !stageArg) throw new Error("usage: node scripts/import-external-benchmark-evidence.ts --file=<run.json> --stage=R3|R12|R19");
const stage = stageArg.slice(8);
if (!(["R3", "R12", "R19"] as const).includes(stage as "R3" | "R12" | "R19")) throw new Error("stage must be R3, R12, or R19");
const run = JSON.parse(await readFile(path.resolve(fileArg.slice(7)), "utf8")) as ExternalBenchmarkRun;
const decision = validateExternalBenchmarkRun(run, stage as "R3" | "R12" | "R19");
if (!decision.accepted || !decision.evidence) throw new Error(`external evidence rejected: ${decision.reasons.join("; ")}`);

const outputDir = path.resolve(".gai-results");
await mkdir(outputDir, { recursive: true });
const output = path.join(outputDir, `external-evidence-${stage}-${run.benchmark}-${run.id}.json`);
const evidence: ResearchEvidence[] = [decision.evidence];
await writeFile(output, JSON.stringify(evidence, null, 2), "utf8");
console.log(JSON.stringify({ accepted: true, output, evidenceId: decision.evidence.id }, null, 2));
