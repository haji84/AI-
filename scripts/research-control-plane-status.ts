import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { routeResearchQueue, type ResearchWorkerState, type ResearchWorkRequest } from "../src/gai/research-control-plane.ts";

const workerArg = process.argv.find((arg) => arg.startsWith("--worker-state="));
const workerPath = path.resolve(workerArg?.slice("--worker-state=".length) || ".gai-results/worker-state.json");
const parsed = JSON.parse(await readFile(workerPath, "utf8")) as { workers?: ResearchWorkerState[] };
const workers = parsed.workers ?? [];

const queue: ResearchWorkRequest[] = [
  { id: "evidence-ledger", kind: "evidence" },
  { id: "research-control", kind: "control" },
  { id: "R2", kind: "local-model", preferredWorkerId: "zbook" },
  { id: "R13", kind: "cross-device" },
  { id: "R18", kind: "gpu", preferredWorkerId: "zbook" },
  { id: "R3/R12/R19", kind: "external-runtime" },
  { id: "R20", kind: "human-review" },
];

const routes = routeResearchQueue(queue, workers);
const report = {
  schemaVersion: 1,
  policy: "GitHub-hosted control/evidence work never waits on a workstation. Worker-only jobs defer and resume when capability returns.",
  workers,
  routes,
  hostedRunnable: routes.filter((item) => item.action === "run-hosted").map((item) => item.requestId),
  workerRunnable: routes.filter((item) => item.action === "run-worker").map((item) => item.requestId),
  deferred: routes.filter((item) => item.action === "defer").map((item) => ({ id: item.requestId, state: item.queueState, reason: item.reason })),
  generatedAt: new Date().toISOString(),
};
await mkdir(path.resolve(".gai-results"), { recursive: true });
await writeFile(path.resolve(".gai-results/research-control-plane-status.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
