import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

import {
  auditText,
  formatFindings,
  scanRepository,
} from "../scripts/jarvis-secret-audit.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function supportedCredentialFixtures() {
  return [
    ["private-key-pem", ["-----BEGIN ", "PRIVATE KEY-----"].join("")],
    ["github-token", ["gh", "p_", "A".repeat(30)].join("")],
    ["aws-access-key-id", ["AK", "IA", "B".repeat(16)].join("")],
    ["slack-token", ["xo", "xb-", "C".repeat(20)].join("")],
    ["openai-api-key", ["sk-", "proj-", "D".repeat(24)].join("")],
  ];
}

test("SEC-011 detects every supported high-confidence credential class without exposing values", () => {
  const fixtures = supportedCredentialFixtures();
  const text = fixtures.map(([, value]) => value).join("\n");
  const findings = auditText(text, { path: "fixture.txt", source: false });

  assert.deepEqual(
    findings.map((finding) => finding.rule),
    fixtures.map(([rule]) => rule),
  );

  const rendered = formatFindings(findings);
  for (const [rule, value] of fixtures) {
    assert.match(rendered, new RegExp(rule));
    assert.equal(rendered.includes(value), false);
    assert.equal(JSON.stringify(findings).includes(value), false);
  }
});

test("SEC-011 current committed-text scope has zero high-confidence secret findings", () => {
  const findings = scanRepository(repositoryRoot);
  assert.deepEqual(findings, [], formatFindings(findings));
});
