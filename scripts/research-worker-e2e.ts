import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname, platform } from "node:os";
import { randomBytes } from "node:crypto";

import { GeneralResearchExecutor, createHttpResearchWorkerRunner } from "../src/gai/research-executor.ts";
import { routeResearchWork, type ResearchWorkKind, type ResearchWorkerState } from "../src/gai/research-control-plane.ts";

const os = platform() === "win32" ? "windows" : platform() === "darwin" ? "macos" : "linux";
const workerId = process.env.GAI_WORKER_ID?.trim() || (os === "windows" ? "zbook" : os === "macos" ? "macbook" : hostname());
const modelEndpoint = (process.env.GAI_LOCAL_MODEL_ENDPOINT?.trim() || "http://127.0.0.1:11434").replace(/\/$/, "");
const kind = (process.env.E2E_RESEARCH_KIND?.trim() || (os === "windows" ? "gpu" : "local-model")) as ResearchWorkKind;
const port = Number(process.env.E2E_RESEARCH_WORKER_PORT || 18795);
const token = randomBytes(24).toString("base64url");
const serviceUrl = `http://127.0.0.1:${port}`;
const resultPath = `.gai-results/research-worker-e2e-${workerId}.json`;

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body as Record<string, unknown>;
}

async function discoverModel(): Promise<string> {
  const configured = process.env.GAI_LOCAL_MODEL_NAME?.trim();
  if (configured) return configured;
  const tags = await fetchJson(`${modelEndpoint}/api/tags`);
  const models = Array.isArray(tags.models) ? tags.models as Array<{ name?: unknown; model?: unknown }> : [];
  const first = models.find((item) => typeof item.name === "string" || typeof item.model === "string");
  const name = typeof first?.name === "string" ? first.name : typeof first?.model === "string" ? first.model : "";
  if (!name) throw new Error(`No local model is installed at ${modelEndpoint}`);
  return name;
}

async function waitForHealth(deadlineMs = 15_000) {
  const deadline = Date.now() + deadlineMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(`${serviceUrl}/health`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Research worker service did not become healthy");
}

async function main() {
  await mkdir(".gai-results", { recursive: true });
  const model = await discoverModel();
  const startedAt = new Date().toISOString();
  const service = spawn(process.execPath, ["scripts/research-worker-service.ts"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GAI_WORKER_ID: workerId,
      GAI_LOCAL_MODEL_ENDPOINT: modelEndpoint,
      GAI_LOCAL_MODEL_NAME: model,
      RESEARCH_WORKER_HOST: "127.0.0.1",
      RESEARCH_WORKER_PORT: String(port),
      RESEARCH_WORKER_TOKEN: token,
    },
  });
  let stderr = "";
  service.stderr.on("data", (chunk) => { stderr += String(chunk); });

  try {
    const health = await waitForHealth();
    const state: ResearchWorkerState = {
      id: workerId,
      platform: os,
      online: true,
      busy: false,
      capabilities: ["local-model", "filesystem", "long-running", ...(os === "windows" ? ["gpu", "windows-tooling"] as const : ["macos-tooling"] as const)],
    };
    const route = routeResearchWork({ id: "e2e-real-research", kind, preferredWorkerId: workerId }, [state]);
    if (route.action !== "run-worker" || route.workerId !== workerId) {
      throw new Error(`Research control plane did not select ${workerId}: ${JSON.stringify(route)}`);
    }

    const worker = createHttpResearchWorkerRunner({
      endpoints: { [workerId]: { url: serviceUrl, token } },
      timeoutMs: 120_000,
    });
    const executor = new GeneralResearchExecutor({
      hosted: { async execute() { throw new Error("Hosted execution was not expected in real worker E2E"); } },
      worker,
    });
    const result = await executor.execute({
      id: "e2e-real-research",
      query: "この端末のローカルResearch Workerが実際に推論できているか確認し、与えられた根拠だけから一文で答えて。",
      kind,
      route,
      context: [{ source: "e2e.fixture", summary: `worker=${workerId}; platform=${os}; purpose=real-local-model-e2e` }],
    });
    if (!result.ok) throw new Error(`${result.blocker ?? "RESEARCH_FAILED"}: ${result.summary}`);

    const report = {
      ok: true,
      workerId,
      platform: os,
      kind,
      model,
      modelEndpoint,
      route,
      health,
      result,
      startedAt,
      completedAt: new Date().toISOString(),
    };
    await writeFile(resultPath, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const report = {
      ok: false,
      workerId,
      platform: os,
      kind,
      modelEndpoint,
      blocker: error instanceof Error ? error.message : String(error),
      serviceStderr: stderr.slice(-4000),
      startedAt,
      completedAt: new Date().toISOString(),
    };
    await writeFile(resultPath, JSON.stringify(report, null, 2), "utf8");
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    service.kill();
  }
}

await main();
