import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { GeneralResearchExecutor, createHttpResearchWorkerRunner } from "../src/gai/research-executor.ts";
import { routeResearchWork, type ResearchWorkerState } from "../src/gai/research-control-plane.ts";
import { createTaskCompletionAuthorization, requestsTaskCompletion } from "../src/orchestrator/task-authorization.ts";

const command = process.env.E2E_OWNER_COMMAND?.trim() || "この調査やっといて";
const researchQuery = process.env.E2E_RESEARCH_QUERY?.trim()
  || "与えられた根拠だけを使って、このResearch WorkerがZBook上のローカルモデルで実際に推論したことを一文で確認して。";
const serviceUrl = (process.env.E2E_RESEARCH_WORKER_URL?.trim() || "http://127.0.0.1:8795").replace(/\/$/, "");
const resultPath = ".gai-results/resident-research-command-e2e.json";
const tokenPath = process.env.E2E_RESEARCH_WORKER_TOKEN_PATH?.trim()
  || (process.platform === "win32"
    ? join(process.env.LOCALAPPDATA || homedir(), "GAIWorker", "research-worker", "token.txt")
    : join(homedir(), "Library", "Application Support", "GAIWorker", "research-worker", "token.txt"));

async function fetchHealth(url: string) {
  const response = await fetch(`${url}/health`);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object") throw new Error(`resident worker health failed: HTTP ${response.status}`);
  return body as Record<string, unknown>;
}

async function main() {
  await mkdir(".gai-results", { recursive: true });
  const startedAt = new Date().toISOString();
  const health = await fetchHealth(serviceUrl);
  if (health.ok !== true || health.workerId !== "zbook") throw new Error(`unexpected ZBook resident health: ${JSON.stringify(health)}`);

  if (!requestsTaskCompletion(command)) throw new Error(`owner command was not recognized as delegated completion: ${command}`);
  const authorization = createTaskCompletionAuthorization(command, { idFactory: () => "resident-research-e2e" });
  if (!authorization) throw new Error("task completion authorization was not created");

  const macbookVerified = process.env.E2E_MACBOOK_RESIDENT_VERIFIED === "1";
  const workers: ResearchWorkerState[] = [
    {
      id: "macbook",
      platform: "macos",
      online: macbookVerified,
      busy: false,
      capabilities: ["local-model", "filesystem", "long-running", "macos-tooling"],
    },
    {
      id: "zbook",
      platform: "windows",
      online: true,
      busy: false,
      capabilities: ["local-model", "gpu", "filesystem", "long-running", "windows-tooling"],
    },
  ];

  const route = routeResearchWork({ id: "resident-natural-command-e2e", kind: "gpu" }, workers);
  if (route.action !== "run-worker" || route.workerId !== "zbook") {
    throw new Error(`GPU research was not routed to ZBook: ${JSON.stringify(route)}`);
  }

  const token = (await readFile(tokenPath, "utf8")).trim();
  if (!token) throw new Error(`resident worker token is empty: ${tokenPath}`);
  const worker = createHttpResearchWorkerRunner({
    endpoints: { zbook: { url: serviceUrl, token } },
    timeoutMs: 120_000,
  });
  const executor = new GeneralResearchExecutor({
    hosted: { async execute() { throw new Error("hosted execution was not expected"); } },
    worker,
  });
  const result = await executor.execute({
    id: "resident-natural-command-e2e",
    query: `${command}\n\n調査内容: ${researchQuery}`,
    kind: "gpu",
    route,
    context: [
      { source: "resident.e2e", summary: "MacBook resident Research Worker health was verified by its real self-hosted runner." },
      { source: "resident.e2e", summary: "ZBook resident Research Worker health is live on localhost and ZBook advertises local-model + gpu." },
      { source: "resident.e2e", summary: "The expected selected execution device is ZBook for GPU research." },
    ],
  });
  if (!result.ok || !result.summary.trim()) throw new Error(`${result.blocker ?? "RESEARCH_FAILED"}: ${result.summary}`);

  const report = {
    ok: true,
    command,
    delegatedAuthorization: {
      kind: authorization.kind,
      scopeId: authorization.scopeId,
      issuedBy: authorization.issuedBy,
    },
    macbookResidentVerified: macbookVerified,
    zbookResidentHealth: health,
    route,
    selectedWorker: route.workerId,
    researchKind: "gpu",
    result,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await writeFile(resultPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch(async (error) => {
  await mkdir(".gai-results", { recursive: true });
  const report = { ok: false, command, blocker: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() };
  await writeFile(resultPath, JSON.stringify(report, null, 2), "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
