import type { JarvisTask } from "./types.ts";

export interface JarvisTaskResultVerification {
  pass: boolean;
  confidence: number;
  reason: string;
  checks: string[];
}

const fail = (reason: string, checks: string[] = []): JarvisTaskResultVerification => ({
  pass: false,
  confidence: 0,
  reason,
  checks,
});

const pass = (reason: string, checks: string[]): JarvisTaskResultVerification => ({
  pass: true,
  confidence: 1,
  reason,
  checks,
});

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const sameText = (actual: unknown, expected: unknown): boolean =>
  typeof actual === "string" && typeof expected === "string" && actual === expected;

/**
 * Host-side deterministic verification for signed Android worker task results.
 *
 * A valid worker signature authenticates the sender and bytes. It does not make
 * a worker-provided `verification.pass` field authoritative. This verifier
 * ignores worker self-attestation and evaluates task-specific evidence against
 * the server-owned task contract.
 *
 * The checks here are intentionally strict and fail closed. A task type without
 * an explicit verifier cannot transition to completed through the Broker.
 */
export function verifyWorkerTaskResult(
  task: JarvisTask | undefined,
  nodeId: string,
  detail: Record<string, unknown>,
): JarvisTaskResultVerification {
  if (!task) return fail("task-not-found");
  if (task.assignedNodeId !== nodeId) return fail("task-node-mismatch");
  if (task.status !== "running" && task.status !== "leased") return fail("task-not-active");

  const checks = ["task-bound", "node-bound", "active-task"];

  switch (task.type) {
    case "open-url":
      if (!sameText(detail.url, task.payload.url) || detail.opened !== true) return fail("open-url-evidence-mismatch", checks);
      return pass("open-url-verified", [...checks, "url-match", "opened"]);
    case "open-app":
      if (!sameText(detail.packageName, task.payload.packageName) || detail.foreground !== true) return fail("open-app-evidence-mismatch", checks);
      return pass("open-app-verified", [...checks, "package-match", "foreground"]);
    case "launch-settings": {
      const expected = typeof task.payload.screen === "string" ? task.payload.screen : "settings";
      if (!sameText(detail.screen, expected) || detail.opened !== true) return fail("settings-evidence-mismatch", checks);
      return pass("settings-verified", [...checks, "screen-match", "opened"]);
    }
    case "wake-device":
      if (detail.screenInteractive !== true) return fail("wake-evidence-missing", checks);
      return pass("wake-verified", [...checks, "screen-interactive"]);
    case "device-status": {
      const telemetry = record(detail.telemetry);
      if (!telemetry || typeof telemetry.checkedAt !== "string" || !Number.isFinite(Date.parse(telemetry.checkedAt))) return fail("device-status-evidence-invalid", checks);
      return pass("device-status-verified", [...checks, "fresh-telemetry-shape"]);
    }
    case "show-notification": {
      const expectedId = typeof task.payload.id === "number" ? task.payload.id : 4100;
      if (detail.shown !== true || detail.id !== expectedId) return fail("notification-evidence-mismatch", checks);
      return pass("notification-verified", [...checks, "notification-id-match", "shown"]);
    }
    case "lock-device":
      if (detail.locked !== true) return fail("lock-evidence-missing", checks);
      return pass("lock-verified", [...checks, "locked"]);
    case "reboot":
      if (detail.rebootScheduled !== true) return fail("reboot-evidence-missing", checks);
      return pass("reboot-scheduled-verified", [...checks, "reboot-scheduled"]);
    case "ui-sequence": {
      const steps = Array.isArray(task.payload.steps) ? task.payload.steps.length : 0;
      if (steps < 1 || detail.completedSteps !== steps) return fail("ui-sequence-evidence-mismatch", checks);
      return pass("ui-sequence-verified", [...checks, "step-count-match"]);
    }
    default:
      return fail("no-host-verifier-for-task-type", checks);
  }
}
