#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function checkedLoopbackBase(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("daily driver live acceptance requires a loopback HTTP broker");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function jsonRequest(baseUrl, token, path, init = {}) {
  const response = await fetch(baseUrl + path, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function hashNodeId(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export async function runDailyDriverLiveE2E({
  baseUrl,
  token,
  runId,
  runAttempt,
  pollMs = 1_000,
  timeoutMs = 180_000,
}) {
  if (!token?.trim()) throw new Error("JARVIS_OWNER_TOKEN is required");
  const base = checkedLoopbackBase(baseUrl);
  const idempotencyKey = `daily-driver-live-${runId}-${runAttempt}`;
  const acceptedAt = new Date().toISOString();

  const receipt = await jsonRequest(base, token, "/api/jarvis/admin/work", {
    method: "POST",
    body: JSON.stringify({
      text: "端末の状態を確認して",
      idempotencyKey,
    }),
  });

  if (receipt.status !== 202) {
    throw new Error(`Daily Driver intake failed with HTTP ${receipt.status}`);
  }
  if (receipt.body?.accepted !== true || receipt.body?.executionScheduled !== true || receipt.body?.action !== "DEVICE_ACTION") {
    throw new Error("Daily Driver did not schedule a standalone device action");
  }
  const task = receipt.body?.task;
  if (!task?.id || task?.type !== "device-status") {
    throw new Error("Daily Driver receipt did not contain the expected device-status task");
  }

  const transitions = [];
  let lastStatus = "";
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let current = task;

  while (Date.now() < deadline) {
    const stateResponse = await jsonRequest(base, token, "/api/jarvis/admin/state");
    if (stateResponse.status !== 200) throw new Error(`Control-plane state failed with HTTP ${stateResponse.status}`);
    lastState = stateResponse.body;
    current = Array.isArray(lastState?.tasks)
      ? lastState.tasks.find(candidate => candidate?.id === task.id) ?? current
      : current;
    const status = String(current?.status ?? "");
    if (status && status !== lastStatus) {
      transitions.push({ status, observedAt: new Date().toISOString() });
      lastStatus = status;
    }
    if (status === "completed") {
      const targetNodeId = String(current?.targetNodeId ?? "").trim();
      if (!targetNodeId) throw new Error("Completed physical Daily Driver task has no assigned Android node");
      return {
        schemaVersion: 1,
        status: "PHYSICAL_DEVICE_ACTION_COMPLETED",
        acceptance: "daily-driver-safe-device-status",
        acceptedAt,
        completedAt: new Date().toISOString(),
        executionScheduled: true,
        registeredFleetCount: Number(lastState?.stats?.registered ?? 0),
        task: {
          id: String(task.id),
          type: String(current.type ?? task.type),
          status,
          targetNodeHash: hashNodeId(targetNodeId),
          detailKeys: current?.detail && typeof current.detail === "object" && !Array.isArray(current.detail)
            ? Object.keys(current.detail).sort()
            : [],
        },
        transitions,
        secretsPersisted: false,
      };
    }
    if (["failed", "cancelled", "expired"].includes(status)) {
      throw new Error(`Physical Daily Driver task reached terminal failure: ${status}`);
    }
    await sleep(pollMs);
  }

  throw new Error(`Physical Daily Driver task did not complete before timeout; lastStatus=${lastStatus || "unknown"}`);
}

async function cli() {
  const output = process.env.GORIQ_DAILY_DRIVER_EVIDENCE?.trim();
  if (!output) throw new Error("GORIQ_DAILY_DRIVER_EVIDENCE is required");
  const common = {
    baseUrl: process.env.GORIQ_DAILY_DRIVER_BASE_URL?.trim() || "http://127.0.0.1:8787",
    token: process.env.JARVIS_OWNER_TOKEN?.trim() || "",
    runId: process.env.GITHUB_RUN_ID?.trim() || "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT?.trim() || "1",
  };
  await mkdir(dirname(output), { recursive: true });
  try {
    const evidence = await runDailyDriverLiveE2E(common);
    await writeFile(output, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ status: evidence.status, taskId: evidence.task.id, taskStatus: evidence.task.status }));
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      status: "FAILED",
      acceptance: "daily-driver-safe-device-status",
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message.slice(0, 1000) : "unknown error",
      secretsPersisted: false,
    };
    await writeFile(output, JSON.stringify(failure, null, 2) + "\n", { mode: 0o600 });
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  cli().catch(error => {
    console.error("[goriq-daily-driver-live-e2e]", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
