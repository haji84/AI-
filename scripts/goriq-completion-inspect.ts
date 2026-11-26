import { readFileSync } from "node:fs";
import { assessCompletionPath, type CompletionInput, type CompletionCycle } from "../src/orchestrator/completion-path.ts";
import type { WorkState } from "../src/orchestrator/work-state.ts";

// Explicit local snapshot only. No Goal creation, network, live store or executor.
const args = process.argv.slice(2);
if (args.length !== 1) throw Error("Usage: node scripts/goriq-completion-inspect.ts <trusted-snapshot.json>");
const bytes = readFileSync(args[0]);
if (bytes.length > 2_000_000) throw Error("snapshot exceeds advisory input limit");
const snapshot = JSON.parse(bytes.toString("utf8")) as { state: WorkState; input: CompletionInput; history?: CompletionCycle[] };
process.stdout.write(`${JSON.stringify(assessCompletionPath(snapshot.state, snapshot.input, snapshot.history), null, 2)}\n`);
