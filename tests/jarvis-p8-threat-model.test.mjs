import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const threatModel = readFileSync(new URL("../docs/architecture/phase20-security-invariant.md", import.meta.url), "utf8");

const REQUIRED_SECTIONS = [
  "## Protected assets",
  "## Trust boundaries",
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

test("P8 threat model keeps privacy blackout and recovery evidence bounded", () => {
  assert.match(threatModel, /Privacy Blackout is a display-protection control/);
  assert.match(threatModel, /must not hide safety warnings or Human Takeover state/);
  assert.match(threatModel, /Physical recovery claims require physical evidence/);
  assert.match(threatModel, /does not establish general intelligence or any AGI completion claim/);
});
