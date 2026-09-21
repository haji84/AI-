import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const threatModel = readFileSync(new URL("../docs/architecture/phase20-security-invariant.md", import.meta.url), "utf8");

const REQUIRED_SECTIONS = [
  "## Protected assets",
  "## Trust boundaries",
  "## Concrete adversaries and abuse cases",
  "## Owner and session authentication",
  "## Worker identity, signing, freshness, and replay protection",
  "## Device allowlist and capability authorization",
  "## Private ingress and transport",
  "## Remote Assist, recording, and privacy blackout",
  "## Secrets and logs",
  "## Human Gates and no-paid-default routing",
  "## Verifier and fail-closed behavior",
  "## Availability and recovery",
  "## Residual limits and evidence boundary",
];

test("P8 threat model retains all critical defensive boundary sections", () => {
  for (const section of REQUIRED_SECTIONS) assert.ok(threatModel.includes(section), `missing ${section}`);
});

test("P8 threat model keeps authorization separate from model and worker output", () => {
  assert.match(threatModel, /cannot create new permission by itself/i);
  assert.match(threatModel, /owner\/session state, registered worker identity, task-scoped capability, policy evaluation, and Human Gate state/i);
});

test("P8 threat model preserves signing freshness replay private ingress and paid-route constraints", () => {
  assert.match(threatModel, /invalid signatures/);
  assert.match(threatModel, /reused nonces/);
  assert.match(threatModel, /stale or replayed signed message remains invalid/);
  assert.match(threatModel, /private by default/);
  assert.match(threatModel, /must not be selected silently/);
});

test("P8 threat model names concrete private-ingress fleet assist recovery and protected-action abuse cases", () => {
  assert.match(threatModel, /\| Private ingress \|/);
  assert.match(threatModel, /public Funnel is prohibited/);
  assert.match(threatModel, /\| Fleet identity and capability \|/);
  assert.match(threatModel, /replacement cannot inherit trust from a label/);
  assert.match(threatModel, /\| Remote Assist and Human Takeover \|/);
  assert.match(threatModel, /audit-before-protected-capture/);
  assert.match(threatModel, /\| Restart, reconnect, and replay \|/);
  assert.match(threatModel, /blocked\/waiting\/approval-required states survive recovery/);
  assert.match(threatModel, /\| Protected actions \|/);
  assert.match(threatModel, /cannot approve their own protected action/);
  assert.match(threatModel, /\| Provider\/cost routing \|/);
  assert.match(threatModel, /billing Human Gate/);
});

test("P8 threat model keeps privacy blackout and recovery evidence bounded", () => {
  assert.match(threatModel, /Privacy Blackout is a display-protection control/);
  assert.match(threatModel, /must not hide safety warnings or Human Takeover state/);
  assert.match(threatModel, /Physical recovery claims require physical evidence/);
  assert.match(threatModel, /does not establish general intelligence or any AGI completion claim/);
});
