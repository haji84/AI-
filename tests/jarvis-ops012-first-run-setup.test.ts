import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

import { buildJarvisFirstRunSetup } from "../src/jarvis/first-run-setup.ts";
import type { JarvisSelfDiagnosticReport } from "../src/jarvis/self-diagnostics.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function report(overrides: Partial<Record<string, "ready" | "blocked" | "pending" | "unknown">> = {}): JarvisSelfDiagnosticReport {
  const states = {
    AUTH: "ready",
    BUILD: "ready",
    TAILSCALE: "ready",
    HOST: "ready",
    BROKER: "ready",
    GATEWAY: "ready",
    WORKER: "ready",
    DEVICE_PERMISSION: "ready",
    FIRMWARE_GATE: "pending",
    HUMAN_GATE: "ready",
    ...overrides,
  } as const;

  return {
    overall: Object.values(states).includes("blocked") ? "blocked" : Object.values(states).includes("pending") ? "pending" : Object.values(states).includes("unknown") ? "unknown" : "ready",
    items: Object.entries(states).map(([code, state]) => ({
      code: code as JarvisSelfDiagnosticReport["items"][number]["code"],
      label: code,
      state,
      detail: `${code}:${state}`,
    })),
  };
}

test("OPS-012 integrates host, connection, and permission readiness without inventing physical readiness", () => {
  const setup = buildJarvisFirstRunSetup(report());

  assert.equal(setup.overall, "ready");
  assert.deepEqual(setup.steps.map((step) => step.id), ["host", "connection", "permission"]);
  assert.equal(setup.steps.every((step) => step.state === "ready"), true);
  assert.equal(setup.steps.some((step) => step.diagnosticCodes.includes("FIRMWARE_GATE")), false);
  assert.equal(setup.steps.some((step) => step.diagnosticCodes.includes("HUMAN_GATE")), false);
});

test("OPS-012 fails closed when required setup evidence is blocked, unknown, pending, or absent", () => {
  const blocked = buildJarvisFirstRunSetup(report({ BROKER: "blocked" }));
  assert.equal(blocked.overall, "blocked");
  assert.equal(blocked.steps.find((step) => step.id === "connection")?.state, "blocked");

  const unknown = buildJarvisFirstRunSetup(report({ DEVICE_PERMISSION: "unknown" }));
  assert.equal(unknown.overall, "unknown");
  assert.equal(unknown.steps.find((step) => step.id === "permission")?.state, "unknown");

  const pending = buildJarvisFirstRunSetup(report({ AUTH: "pending" }));
  assert.equal(pending.overall, "pending");
  assert.equal(pending.steps.find((step) => step.id === "host")?.state, "pending");

  const missing: JarvisSelfDiagnosticReport = {
    overall: "ready",
    items: report().items.filter((item) => item.code !== "HOST"),
  };
  const missingSetup = buildJarvisFirstRunSetup(missing);
  assert.equal(missingSetup.overall, "unknown");
  assert.equal(missingSetup.steps.find((step) => step.id === "host")?.state, "unknown");
});

test("OPS-012 setup surface is read-only and uses canonical diagnostics instead of a second source of truth", () => {
  const page = read("src/app/jarvis/setup/page.tsx");
  const home = read("src/app/jarvis/page.tsx");

  assert.match(page, /\/api\/jarvis\/diagnostics/);
  assert.doesNotMatch(page, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(page, /\/api\/jarvis\/action/);
  assert.match(page, /buildJarvisFirstRunSetup/);
  assert.match(page, /\/jarvis\/enroll/);
  assert.match(home, /href=["']\/jarvis\/setup["']/);
});
