import assert from "node:assert/strict";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

import {
  auditText,
  formatFindings,
  scanRepository,
} from "../scripts/jarvis-secret-audit.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

const consoleLevels = ["debug", "error", "info", "log", "trace", "warn"];
const sensitiveIdentifiers = [
  "authorization",
  "bearerToken",
  "ownerSecret",
  "ownerToken",
  "passcode",
  "password",
  "privateKey",
  "secret",
  "sessionToken",
  "token",
];

test("SEC-012 rejects direct sensitive identifiers across supported console levels", () => {
  const source = consoleLevels
    .map((level, index) => `console.${level}(${sensitiveIdentifiers[index]});`)
    .join("\n");

  const findings = auditText(source, { path: "fixture.ts", source: true });
  assert.equal(findings.length, consoleLevels.length);
  assert.deepEqual(
    findings.map((finding) => finding.rule),
    consoleLevels.map(() => "sensitive-value-console-log"),
  );
});

test("SEC-012 rejects multiline direct sensitive logging without exposing the value", () => {
  const credential = ["sk-", "proj-", "E".repeat(24)].join("");
  const source = [
    `const ownerToken = ${JSON.stringify(credential)};`,
    "console.info(",
    "  { status: \"rejected\", ownerToken },",
    ");",
  ].join("\n");

  const findings = auditText(source, { path: "fixture.ts", source: true });
  assert.deepEqual(
    findings.map((finding) => finding.rule),
    ["openai-api-key", "sensitive-value-console-log"],
  );

  const rendered = formatFindings(findings);
  assert.equal(rendered.includes(credential), false);
  assert.equal(JSON.stringify(findings).includes(credential), false);
});

test("SEC-012 allows non-sensitive status text containing security words", () => {
  const findings = auditText([
    "console.info(\"token refresh failed\");",
    "console.warn(\"password reset requested\");",
  ].join("\n"), { path: "fixture.ts", source: true });

  assert.deepEqual(findings, []);
});

test("SEC-012 current committed-text scope has zero secret or sensitive-log findings", () => {
  const findings = scanRepository(repositoryRoot);
  assert.deepEqual(findings, [], formatFindings(findings));
});
