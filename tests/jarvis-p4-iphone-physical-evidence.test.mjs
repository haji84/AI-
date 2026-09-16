import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const auditUrl = new URL(
  "../docs/audit/jarvis-p4-iphone-physical-evidence-2026-09-16.md",
  import.meta.url,
);

const EVIDENCE_SHA = "553b58a40c0ce2bcd341911c84f06d969e1a6380";
const TASK_ID = "iphone-physical-e2e-004";

test("P4 iPhone audit pins exact historical physical evidence without current-main overclaim", async () => {
  const audit = await readFile(auditUrl, "utf8");

  assert.match(audit, /historical exact-SHA physical evidence audit only/i);
  assert.match(audit, /does not create a new device run/i);
  assert.match(audit, /does not revalidate current `main`/i);
  assert.ok(audit.includes(EVIDENCE_SHA));
  assert.ok(audit.includes(TASK_ID));
  assert.match(audit, /QUEUED[\s\S]*DELIVERED[\s\S]*VERIFIED RESULT physical=true/);

  for (const requirementId of [
    "DEV-I-001",
    "DEV-I-002",
    "DEV-I-003",
    "DEV-I-004",
    "DEV-I-005",
    "DEV-I-006",
  ]) {
    assert.ok(audit.includes(`\`${requirementId}\``), `missing ${requirementId} mapping`);
  }

  assert.match(audit, /DEV-I-007[\s\S]*iOS lifecycle\/background constraints/i);
  assert.match(audit, /DEV-I-008[\s\S]*conservative/i);
  assert.match(audit, /does not turn simulator, CI, source-contract tests, or this document into new PHYSICAL evidence/i);
  assert.match(audit, /Final P9 acceptance must still bind[\s\S]*exact commit actually tested/i);
});

test("P4 iPhone audit records the implementation provenance without credential material", async () => {
  const audit = await readFile(auditUrl, "utf8");

  for (const reference of ["#609", "#612", "#664", "#666", "#667", "#668", "#669"]) {
    assert.ok(audit.includes(reference), `missing provenance reference ${reference}`);
  }

  assert.match(audit, /HMAC-signed result accepted by the Bridge/i);
  assert.match(audit, /persisted Keychain credential/i);
  assert.match(audit, /reconnect after Bridge restart\/port change/i);
  assert.match(audit, /No secret, private key, enrollment token, password, or credential value is copied/i);
});
