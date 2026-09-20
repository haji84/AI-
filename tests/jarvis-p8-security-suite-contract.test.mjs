import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("P8 security suite remains explicit, focused, and CI-enforced", () => {
  const packageJson = JSON.parse(read("package.json"));
  const securityScript = packageJson.scripts?.["test:p8-security"];

  assert.equal(typeof securityScript, "string");
  for (const requiredTest of [
    "tests/owner-auth.test.ts",
    "tests/jarvis-sec001-owner-auth-integration.test.ts",
    "tests/jarvis-sec002-session-control.test.ts",
    "tests/jarvis-sec003-signed-worker-request.test.ts",
    "tests/jarvis-sec004-signed-result.test.ts",
    "tests/jarvis-p8-negative-security.test.ts",
    "tests/jarvis-p8-threat-model.test.mjs",
    "tests/jarvis-private-worker-ingress.test.ts",
    "tests/jarvis-secret-audit.test.mjs",
    "tests/jarvis-worker-auth-ecdsa.test.ts",
    "tests/jarvis-worker-identity-store.test.ts",
    "tests/jarvis-enrollment-security.test.ts",
    "tests/human-gate-shortcuts.test.ts",
    "tests/secret-op-approval.test.ts",
    "tests/task-authorization.test.ts",
    "tests/no-paid-ai-runtime.test.ts",
    "tests/jarvis-remote-assist-audit.test.ts",
    "tests/jarvis-remote-assist-session.test.ts",
    "tests/jarvis-display-modes.test.ts",
  ]) {
    assert.match(securityScript, new RegExp(requiredTest.replaceAll(".", "\\.")));
  }

  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /P8 Security Regression Suite/);
  assert.match(workflow, /pnpm test:p8-security/);
});

test("P8 audit handoff cannot silently self-certify independent PASS", () => {
  const audit = read("docs/audit/jarvis-p8-independent-security-audit.md");

  assert.match(audit, /Independent audit status: \*\*PENDING\*\*/);
  assert.match(audit, /MUST NOT self-certify/);
  assert.match(audit, /Audited main SHA/);
  assert.match(audit, /Overall independent result/);
  assert.match(audit, /known limitations/i);
  assert.match(audit, /do not prove[\s\S]*PHYSICAL/);
  assert.match(audit, /not evidence for an AGI claim/);
});
