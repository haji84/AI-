import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import * as pcApproval from "../src/jarvis/pc-enrollment.ts";
import { PcEnrollmentService, type PcEnrollmentApproval } from "../src/jarvis/pc-enrollment.ts";

const now = new Date("2026-10-01T11:18:17Z");
const scope: PcEnrollmentApproval = { version: 1, issue: 1662, goalIssue: 1219,
  approvedAt: now.toISOString(), expiresAt: "2026-10-02T11:18:17Z",
  targets: [{ nodeId: "macbook", platform: "macos" }, { nodeId: "zbook", platform: "windows" }],
  roles: ["Executor", "Storage", "Verifier", "Coordinator"] };
const keys = generateKeyPairSync("ed25519");
const input = { nodeId: "macbook", platform: "macos", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), algorithm: "ed25519" };

test("approved PC enrollment requires possession and produces server-owned bounded authority", () => {
  const service = new PcEnrollmentService(scope);
  const offered = service.offer(input, now);
  const proof = sign(null, Buffer.from(offered.proofText), keys.privateKey).toString("base64");
  const result = service.prove(offered.challengeId, proof, now);
  assert.equal(result.node.id, "macbook");
  assert.equal(result.node.kind, "macos");
  assert.equal(result.node.status, "offline");
  assert.deepEqual(result.node.capabilities, ["filesystem"]);
  assert.equal(result.node.policy.allowDestructiveActions, false);
  assert.equal(result.node.pcAuthority?.goalIssue, 1219);
  assert.deepEqual(result.node.pcAuthority?.roles, scope.roles);
  assert.equal(result.identity.nodeId, "macbook");
  assert.throws(() => service.prove(offered.challengeId, proof, now), /expired|unknown/);
});

test("wrong key cannot consume proof and expired challenges fail closed", () => {
  const service = new PcEnrollmentService(scope);
  const offer = service.offer(input, now);
  const wrong = generateKeyPairSync("ed25519");
  assert.throws(() => service.prove(offer.challengeId, sign(null, Buffer.from(offer.proofText), wrong.privateKey).toString("base64"), now), /proof rejected/);
  assert.throws(() => service.prove(offer.challengeId, "invalid", new Date(now.getTime() + 300_000)), /expired|unknown/);
});

test("target, platform, client authority, malformed key and duplicate offer fail closed", () => {
  const service = new PcEnrollmentService(scope);
  for (const value of [ { ...input, nodeId: "other" }, { ...input, platform: "windows" },
    { ...input, roles: ["Owner"] }, { ...input, capabilities: ["remote-control"] },
    { ...input, publicKeyPem: "invalid" }, { ...input, algorithm: "rsa" } ]) assert.throws(() => service.offer(value, now));
  service.offer(input, now);
  assert.throws(() => service.offer(input, now), /pending/);
});

test("missing, expired, overlong or privileged approval cannot authorize enrollment", () => {
  for (const approval of [undefined, { ...scope, expiresAt: now.toISOString() },
    { ...scope, expiresAt: "2026-10-03T11:18:17Z" }, { ...scope, roles: ["Owner"] },
    { ...scope, approvedAt: "2026-10-02T11:18:17Z" }]) {
    assert.throws(() => new PcEnrollmentService(approval as PcEnrollmentApproval).offer(input, now));
  }
});

test("explicit same-scope renewal accepts expired local approval and remains idempotent", () => {
  assert.equal(typeof pcApproval.validatePcApprovalRenewal, "function");
  const currentTime = new Date("2026-10-04T15:00:00Z");
  const renewed = { ...scope, approvedAt: "2026-10-04T14:49:15Z", expiresAt: "2026-10-05T14:49:15Z" };
  assert.deepEqual(pcApproval.validatePcApprovalRenewal(scope, renewed, currentTime), renewed);
  assert.deepEqual(pcApproval.validatePcApprovalRenewal(renewed, renewed, currentTime), renewed);
});

test("local approval renewal rejects changed scope invalid baselines and expired or regressive grants", () => {
  assert.equal(typeof pcApproval.validatePcApprovalRenewal, "function");
  const currentTime = new Date("2026-10-04T15:00:00Z");
  const renewed = { ...scope, approvedAt: "2026-10-04T14:49:15Z", expiresAt: "2026-10-05T14:49:15Z" };
  for (const changed of [
    { ...renewed, issue: 1663 }, { ...renewed, goalIssue: 681 },
    { ...renewed, targets: [...renewed.targets, { nodeId: "other", platform: "linux" }] },
    { ...renewed, roles: ["Executor"] }, { ...renewed, roles: ["Owner"] },
    { ...renewed, expiresAt: "2026-10-06T14:49:15Z" }, { ...renewed, approvedAt: "2026-10-05T14:49:15Z" },
    scope,
  ]) assert.throws(() => pcApproval.validatePcApprovalRenewal(scope, changed, currentTime));
  for (const old of [undefined, { ...scope, expiresAt: scope.approvedAt }, { ...scope, roles: ["Owner"] },
    { ...scope, extraAuthority: true }]) {
    assert.throws(() => pcApproval.validatePcApprovalRenewal(old, renewed, currentTime));
  }
  const laterLocal = { ...renewed, approvedAt: "2026-10-04T14:55:15Z", expiresAt: "2026-10-05T14:55:15Z" };
  assert.throws(() => pcApproval.validatePcApprovalRenewal(laterLocal, renewed, currentTime));
});
