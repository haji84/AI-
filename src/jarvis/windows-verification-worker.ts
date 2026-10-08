import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import type { JarvisTask } from "./types.ts";

const TASK_TYPE = "windows-real-machine-verification";
const REQUEST_SCHEMA = "jarvis.real-machine.v1";
const RESULT_SCHEMA = "jarvis.real-machine-result.v1";
const MAX_TASK_BYTES = 32_000;
const MAX_PROBE_OUTPUT_BYTES = 16_384;
const PROBE_TIMEOUT_MS = 5_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const probeExpression = "JSON.stringify({platform:process.platform,node:process.version})";

export interface WindowsNativeProbeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export type WindowsNativeProbe = () => Promise<WindowsNativeProbeResult>;

export interface WindowsVerificationResultDetail {
  schema: typeof RESULT_SCHEMA;
  operation: "smoke";
  check: "platform";
  platform: "win32";
  nodeVersion: string;
  outputSha256: string;
  checkIds: ["windows-native-process", "platform-win32"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function fail(code: string): never {
  throw new Error(code);
}

export function validateWindowsVerificationTask(task: JarvisTask, nodeId: string): {
  operation: "smoke";
  check: "platform";
} {
  if (!task || typeof task !== "object") fail("windows_worker_invalid_task");
  if (typeof task.id !== "string" || !SAFE_ID.test(task.id)) fail("windows_worker_invalid_task_id");
  if (typeof task.leaseUntil !== "string" || !Number.isFinite(Date.parse(task.leaseUntil))) fail("windows_worker_invalid_lease");
  if (Date.parse(task.leaseUntil) <= Date.now()) fail("windows_worker_lease_expired");
  if (!SAFE_ID.test(nodeId)) fail("windows_worker_invalid_node_id");
  const serialized = JSON.stringify(task);
  if (Buffer.byteLength(serialized, "utf8") > MAX_TASK_BYTES) fail("windows_worker_task_too_large");
  if (task.type !== TASK_TYPE) fail("windows_worker_wrong_task_type");
  if (task.status !== "running") fail("windows_worker_task_not_running");
  if (task.targetNodeId !== nodeId || task.assignedNodeId !== nodeId) fail("windows_worker_node_mismatch");
  if (task.maxAttempts !== 1 || task.attempts !== 1) fail("windows_worker_attempt_policy_mismatch");
  if (task.requiresOnline !== true) fail("windows_worker_online_required");
  if (!Array.isArray(task.requiredCapabilities) || task.requiredCapabilities.length !== 1 || task.requiredCapabilities[0] !== "windows-tooling") {
    fail("windows_worker_capability_mismatch");
  }
  if (!Array.isArray(task.preferredKinds) || task.preferredKinds.length !== 1 || task.preferredKinds[0] !== "windows") {
    fail("windows_worker_platform_mismatch");
  }
  if (!isRecord(task.payload) || !exactKeys(task.payload, ["schema", "operation", "payload"])) {
    fail("windows_worker_invalid_payload_shape");
  }
  if (task.payload.schema !== REQUEST_SCHEMA || task.payload.operation !== "smoke") {
    fail("windows_worker_unsupported_operation");
  }
  const payload = task.payload.payload;
  if (!isRecord(payload) || !exactKeys(payload, ["check"]) || payload.check !== "platform") {
    fail("windows_worker_invalid_smoke_payload");
  }
  return { operation: "smoke", check: "platform" };
}

export function createDefaultWindowsNativeProbe(): WindowsNativeProbe {
  return () => new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    const child = spawn(process.execPath, ["-p", probeExpression], {
      windowsHide: true,
      shell: false,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const finish = (result: WindowsNativeProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += value.length;
      if (stdoutBytes > MAX_PROBE_OUTPUT_BYTES) child.kill();
      else stdout += value.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += value.length;
      if (stderrBytes > MAX_PROBE_OUTPUT_BYTES) child.kill();
      else stderr += value.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error(`windows_worker_probe_spawn_failed:${error.name}`));
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (stdoutBytes > MAX_PROBE_OUTPUT_BYTES || stderrBytes > MAX_PROBE_OUTPUT_BYTES) {
        return finish({ stdout: "", stderr: "", exitCode, timedOut: false });
      }
      finish({ stdout, stderr, exitCode, timedOut });
    });
  });
}

export async function executeWindowsVerificationTask(input: {
  task: JarvisTask;
  nodeId: string;
  runtimePlatform?: NodeJS.Platform;
  probe?: WindowsNativeProbe;
}): Promise<WindowsVerificationResultDetail> {
  const request = validateWindowsVerificationTask(input.task, input.nodeId);
  const runtimePlatform = input.runtimePlatform ?? process.platform;
  if (runtimePlatform !== "win32") fail("windows_worker_not_running_on_windows");

  const result = await (input.probe ?? createDefaultWindowsNativeProbe())();
  if (result.timedOut) fail("windows_worker_probe_timeout");
  if (result.exitCode !== 0) fail("windows_worker_probe_failed");
  if (Buffer.byteLength(result.stdout, "utf8") > MAX_PROBE_OUTPUT_BYTES) fail("windows_worker_probe_output_too_large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    fail("windows_worker_probe_invalid_json");
  }
  if (!isRecord(parsed) || parsed.platform !== "win32" || typeof parsed.node !== "string" || !/^v\d+\.\d+\.\d+$/.test(parsed.node)) {
    fail("windows_worker_probe_evidence_mismatch");
  }

  return {
    schema: RESULT_SCHEMA,
    operation: request.operation,
    check: request.check,
    platform: "win32",
    nodeVersion: parsed.node,
    outputSha256: createHash("sha256").update(result.stdout, "utf8").digest("hex"),
    checkIds: ["windows-native-process", "platform-win32"],
  };
}
