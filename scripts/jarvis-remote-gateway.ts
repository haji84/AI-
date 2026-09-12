import { execFile } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import { classifyQaScreen, defaultQaScreenRules, type QaScreenRules, type QaScreenState } from "../src/jarvis/qa-sequence.ts";

const execFileAsync = promisify(execFile);
const host = process.env.JARVIS_REMOTE_GATEWAY_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.JARVIS_REMOTE_GATEWAY_PORT || 8790);
const token = process.env.JARVIS_REMOTE_GATEWAY_TOKEN?.trim() || "";
const adbPath = process.env.JARVIS_ADB_PATH?.trim() || "adb";
const allowedSerials = new Set((process.env.JARVIS_REMOTE_ALLOWED_SERIALS || "").split(",").map((value) => value.trim()).filter(Boolean));

if (!token) throw new Error("JARVIS_REMOTE_GATEWAY_TOKEN is required");
if (allowedSerials.size === 0) throw new Error("JARVIS_REMOTE_ALLOWED_SERIALS must contain at least one authorized Android serial");
if (host !== "127.0.0.1" && host !== "::1" && process.env.JARVIS_REMOTE_ALLOW_NON_LOOPBACK !== "1") {
  throw new Error("Refusing non-loopback remote gateway bind. Put authenticated TLS ingress in front of the gateway.");
}

const KEYEVENTS = new Set(["BACK", "HOME", "ENTER", "TAB", "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_CENTER", "APP_SWITCH"]);
const PACKAGE_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

type QaRunStatus = "queued" | "running" | "done" | "error-no-retry" | "step1-timeout" | "step2-timeout" | "failed";
type QaRun = {
  id: string;
  serial: string;
  url1: string;
  url2: string;
  packageName: string;
  status: QaRunStatus;
  stage: string;
  step: 1 | 2;
  matched: string[];
  appClosed: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

const qaRuns = new Map<string, QaRun>();
const activeRunBySerial = new Map<string, string>();

function safeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireOwner(request: IncomingMessage): boolean {
  const auth = request.headers.authorization || "";
  return auth.startsWith("Bearer ") && safeEqualText(auth.slice(7), token);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256_000) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required");
  return parsed as Record<string, unknown>;
}

function requireSerial(payload: Record<string, unknown>): string {
  const serial = typeof payload.serial === "string" ? payload.serial.trim() : "";
  if (!serial || !allowedSerials.has(serial)) throw new Error("Android serial is not authorized for JARVIS remote control");
  return serial;
}

async function adb(serial: string, args: string[], timeout = 15_000): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(adbPath, ["-s", serial, ...args], { timeout, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function adbBinary(serial: string, args: string[], timeout = 15_000): Promise<Buffer> {
  const result = await execFileAsync(adbPath, ["-s", serial, ...args], { timeout, maxBuffer: 16 * 1024 * 1024, encoding: "buffer" as BufferEncoding });
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

async function connectedAuthorizedDevices(): Promise<Array<{ serial: string; state: string }>> {
  const result = await execFileAsync(adbPath, ["devices"], { timeout: 10_000, maxBuffer: 1024 * 1024, encoding: "utf8" });
  const rows = (result.stdout ?? "").split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean);
  return rows.map((line) => {
    const [serial, state] = line.split(/\s+/, 2);
    return { serial, state: state || "unknown" };
  }).filter((item) => allowedSerials.has(item.serial));
}

function boundedInt(value: unknown, name: string, min = 0, max = 20_000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function boundedStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  if (values.length === 0 || values.length > 10 || values.some((item) => item.length > 120)) throw new Error("invalid QA screen marker list");
  return values;
}

function screenRules(payload: Record<string, unknown>): QaScreenRules {
  const raw = payload.rules && typeof payload.rules === "object" && !Array.isArray(payload.rules) ? payload.rules as Record<string, unknown> : {};
  return {
    errorAny: boundedStringArray(raw.errorAny, defaultQaScreenRules.errorAny),
    step1All: boundedStringArray(raw.step1All, defaultQaScreenRules.step1All),
    step2All: boundedStringArray(raw.step2All, defaultQaScreenRules.step2All),
  };
}

function updateRun(run: QaRun, patch: Partial<QaRun>): void {
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dumpUi(serial: string): Promise<string> {
  await adb(serial, ["shell", "uiautomator", "dump", "/sdcard/jarvis-window.xml"], 15_000);
  const result = await adb(serial, ["shell", "cat", "/sdcard/jarvis-window.xml"], 15_000);
  return result.stdout;
}

async function waitForState(serial: string, expected: QaScreenState, rules: QaScreenRules, timeoutMs: number, pollMs: number): Promise<{ state: QaScreenState; matched: string[] }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const judged = classifyQaScreen(await dumpUi(serial), rules);
      if (judged.state === "error" || judged.state === expected) return judged;
    } catch {
      // A transient UI-dump failure is not a re-execution. Keep observing until timeout.
    }
    await sleep(pollMs);
  }
  return { state: "pending", matched: [] };
}

async function openUrl(serial: string, target: string): Promise<void> {
  if (!target.startsWith("https://")) throw new Error("QA URL must use HTTPS");
  await adb(serial, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", target], 20_000);
}

async function closeApp(run: QaRun, stage = "closing-app"): Promise<void> {
  updateRun(run, { stage });
  await adb(run.serial, ["shell", "am", "force-stop", run.packageName], 15_000);
  updateRun(run, { appClosed: true });
}

async function stopOnError(run: QaRun, step: 1 | 2, matched: string[]): Promise<void> {
  updateRun(run, { stage: "closing-app-after-error", step, matched });
  await closeApp(run, "closing-app-after-error");
  updateRun(run, { status: "error-no-retry", stage: "stopped", step, matched, appClosed: true });
}

async function runQaSequence(run: QaRun, rules: QaScreenRules, timeoutMs: number, pollMs: number): Promise<void> {
  try {
    updateRun(run, { status: "running", stage: "opening-step1", step: 1 });
    await openUrl(run.serial, run.url1);
    updateRun(run, { stage: "waiting-step1" });
    const first = await waitForState(run.serial, "step1-success", rules, timeoutMs, pollMs);
    if (first.state === "error") {
      await stopOnError(run, 1, first.matched);
      return;
    }
    if (first.state !== "step1-success") {
      updateRun(run, { status: "step1-timeout", stage: "stopped", step: 1 });
      return;
    }

    updateRun(run, { stage: "opening-step2", step: 2, matched: first.matched });
    await openUrl(run.serial, run.url2);
    updateRun(run, { stage: "waiting-step2" });
    const second = await waitForState(run.serial, "step2-success", rules, timeoutMs, pollMs);
    if (second.state === "error") {
      await stopOnError(run, 2, second.matched);
      return;
    }
    if (second.state !== "step2-success") {
      updateRun(run, { status: "step2-timeout", stage: "stopped", step: 2 });
      return;
    }

    updateRun(run, { stage: "closing-app", matched: second.matched });
    await closeApp(run);
    updateRun(run, { status: "done", stage: "done", appClosed: true });
  } catch (error) {
    updateRun(run, { status: "failed", stage: "failed", error: error instanceof Error ? error.message : "QA sequence failed" });
  } finally {
    activeRunBySerial.delete(run.serial);
  }
}

async function handleInput(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serial = requireSerial(payload);
  const action = typeof payload.action === "string" ? payload.action : "";
  if (action === "tap") {
    const x = boundedInt(payload.x, "x");
    const y = boundedInt(payload.y, "y");
    await adb(serial, ["shell", "input", "tap", String(x), String(y)]);
    return { ok: true, serial, action };
  }
  if (action === "swipe") {
    const x1 = boundedInt(payload.x1, "x1");
    const y1 = boundedInt(payload.y1, "y1");
    const x2 = boundedInt(payload.x2, "x2");
    const y2 = boundedInt(payload.y2, "y2");
    const durationMs = boundedInt(payload.durationMs ?? 300, "durationMs", 50, 5_000);
    await adb(serial, ["shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(durationMs)]);
    return { ok: true, serial, action };
  }
  if (action === "text") {
    const text = typeof payload.text === "string" ? payload.text : "";
    if (!text || text.length > 256) throw new Error("text must be between 1 and 256 characters");
    const safe = text.replace(/%/g, "%25").replace(/ /g, "%s");
    await adb(serial, ["shell", "input", "text", safe]);
    return { ok: true, serial, action };
  }
  if (action === "keyevent") {
    const key = typeof payload.key === "string" ? payload.key.toUpperCase() : "";
    if (!KEYEVENTS.has(key)) throw new Error("unsupported keyevent");
    await adb(serial, ["shell", "input", "keyevent", `KEYCODE_${key}`]);
    return { ok: true, serial, action, key };
  }
  throw new Error("unsupported remote input action");
}

async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url || "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/health") {
    const devices = await connectedAuthorizedDevices();
    return json(response, 200, { ok: true, service: "jarvis-remote-gateway", devices });
  }
  if (!requireOwner(request)) return json(response, 401, { message: "remote gateway authorization required" });

  const payload = request.method === "POST" ? await readJson(request) : {};

  if (request.method === "GET" && url.pathname === "/api/remote/devices") {
    const devices = await connectedAuthorizedDevices();
    return json(response, 200, { devices });
  }

  if (request.method === "POST" && url.pathname === "/api/remote/screenshot") {
    const serial = requireSerial(payload);
    const png = await adbBinary(serial, ["exec-out", "screencap", "-p"], 20_000);
    if (!png.length) throw new Error("empty screenshot returned by device");
    return json(response, 200, { serial, mimeType: "image/png", imageBase64: png.toString("base64"), capturedAt: new Date().toISOString() });
  }

  if (request.method === "POST" && url.pathname === "/api/remote/input") {
    return json(response, 200, await handleInput(payload));
  }

  if (request.method === "POST" && url.pathname === "/api/remote/open-url") {
    const serial = requireSerial(payload);
    const target = typeof payload.url === "string" ? payload.url : "";
    await openUrl(serial, target);
    return json(response, 200, { ok: true, serial, url: target });
  }

  if (request.method === "POST" && url.pathname === "/api/remote/qa-sequence/start") {
    const serial = requireSerial(payload);
    const existing = activeRunBySerial.get(serial);
    if (existing) return json(response, 409, { message: "this device already has an active QA sequence", run: qaRuns.get(existing) });
    const url1 = typeof payload.url1 === "string" ? payload.url1.trim() : "";
    const url2 = typeof payload.url2 === "string" ? payload.url2.trim() : "";
    const packageName = typeof payload.packageName === "string" ? payload.packageName.trim() : "";
    if (!url1.startsWith("https://") || !url2.startsWith("https://")) throw new Error("both QA URLs must use HTTPS");
    if (!PACKAGE_RE.test(packageName)) throw new Error("valid Android packageName is required so JARVIS can close the app after completion or error");
    const timeoutMs = boundedInt(payload.timeoutMs ?? 90_000, "timeoutMs", 5_000, 180_000);
    const pollMs = boundedInt(payload.pollMs ?? 1_500, "pollMs", 500, 5_000);
    const rules = screenRules(payload);
    const now = new Date().toISOString();
    const run: QaRun = {
      id: randomUUID(), serial, url1, url2, packageName,
      status: "queued", stage: "queued", step: 1, matched: [], appClosed: false,
      createdAt: now, updatedAt: now,
    };
    qaRuns.set(run.id, run);
    activeRunBySerial.set(serial, run.id);
    void runQaSequence(run, rules, timeoutMs, pollMs);
    return json(response, 202, { run });
  }

  if (request.method === "POST" && url.pathname === "/api/remote/qa-sequence/status") {
    const runId = typeof payload.runId === "string" ? payload.runId : "";
    const run = qaRuns.get(runId);
    if (!run) return json(response, 404, { message: "QA sequence not found" });
    return json(response, 200, { run });
  }

  return json(response, 404, { message: "unknown remote gateway route" });
}

const server = createServer((request, response) => {
  handler(request, response).catch((error) => {
    console.error("[jarvis-remote-gateway] request failed", error);
    json(response, 400, { message: error instanceof Error ? error.message : "remote gateway error" });
  });
});

server.listen(port, host, () => {
  console.log(`[jarvis-remote-gateway] listening on http://${host}:${port}`);
  console.log(`[jarvis-remote-gateway] authorized devices=${allowedSerials.size}`);
});