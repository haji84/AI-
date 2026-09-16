import assert from "node:assert/strict";
import test from "node:test";
import { auditText, formatFindings, scanRepository } from "../scripts/jarvis-secret-audit.mjs";

test("secret audit detects credential material without returning the secret value", () => {
  const pem = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
  const fakeSecret = ["sk-", "proj-", "abcdefghijklmnopqrstuvwxyz012345"].join("");
  const findings = auditText(`${pem}\n${fakeSecret}\n`, { path: "fixture.txt", source: false });
  assert.deepEqual(findings.map((finding) => finding.rule), ["private-key-pem", "openai-api-key"]);
  const rendered = formatFindings(findings);
  assert.match(rendered, /fixture\.txt:1 private-key-pem/);
  assert.match(rendered, /fixture\.txt:2 openai-api-key/);
  assert.equal(rendered.includes(fakeSecret), false);
});

test("secret audit rejects direct sensitive variable logging but allows non-sensitive status text", () => {
  const findings = auditText([
    "const ownerToken = process.env.JARVIS_OWNER_TOKEN;",
    "console.info(\"token refresh failed\");",
    "console.error(ownerToken);",
  ].join("\n"), { path: "fixture.ts", source: true });
  assert.deepEqual(findings, [{ path: "fixture.ts", line: 3, rule: "sensitive-value-console-log" }]);
});

test("current repository passes the high-confidence P8 secret audit", () => {
  const findings = scanRepository(process.cwd());
  assert.deepEqual(findings, [], formatFindings(findings));
});
