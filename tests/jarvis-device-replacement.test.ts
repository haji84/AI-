import test from "node:test";
import assert from "node:assert/strict";
import { planJarvisDeviceReplacement } from "../src/jarvis/device-replacement.ts";
import type { JarvisWorkerIdentity } from "../src/jarvis/worker-auth.ts";

const currentIdentity = (): JarvisWorkerIdentity => ({
  nodeId: "android-001",
  publicKeyPem: "-----BEGIN PUBLIC KEY-----\nOLD-KEY\n-----END PUBLIC KEY-----",
  enrolledAt: "2026-09-15T00:00:00.000Z",
  algorithm: "ed25519",
});

const replacementIdentity = (): JarvisWorkerIdentity => ({
  nodeId: "android-001",
  publicKeyPem: "-----BEGIN PUBLIC KEY-----\nNEW-KEY\n-----END PUBLIC KEY-----",
  enrolledAt: "2026-09-16T00:00:00.000Z",
  algorithm: "ed25519",
});

test("device replacement stays behind Human Gate and does not mutate supplied identities", () => {
  const current = currentIdentity();
  const replacement = replacementIdentity();
  const plan = planJarvisDeviceReplacement({
    nodeId: "android-001",
    currentIdentity: current,
    replacementIdentity: replacement,
    proposedAt: "2026-09-16T04:30:00.000Z",
  });

  assert.equal(plan.status, "AWAITING_HUMAN_GATE");
  assert.equal(plan.requiresHumanGate, true);
  assert.equal(plan.action, "replace-worker-identity");
  assert.equal(plan.proposedAfterApproval.revokedIdentity.revokedAt, "2026-09-16T04:30:00.000Z");
  assert.equal(plan.proposedAfterApproval.replacementIdentity.revokedAt, undefined);
  assert.notEqual(plan.oldIdentityFingerprint, plan.replacementIdentityFingerprint);
  assert.equal(current.revokedAt, undefined);
  assert.equal(replacement.revokedAt, undefined);
});

test("device replacement rejects logical node mismatch", () => {
  const replacement = replacementIdentity();
  replacement.nodeId = "android-002";
  assert.throws(
    () => planJarvisDeviceReplacement({
      nodeId: "android-001",
      currentIdentity: currentIdentity(),
      replacementIdentity: replacement,
      proposedAt: "2026-09-16T04:30:00.000Z",
    }),
    /replacement worker identity does not match replacement node/,
  );
});

test("device replacement rejects an already revoked current identity", () => {
  const current = currentIdentity();
  current.revokedAt = "2026-09-15T12:00:00.000Z";
  assert.throws(
    () => planJarvisDeviceReplacement({
      nodeId: "android-001",
      currentIdentity: current,
      replacementIdentity: replacementIdentity(),
      proposedAt: "2026-09-16T04:30:00.000Z",
    }),
    /already revoked/,
  );
});

test("device replacement rejects reuse of the existing public key", () => {
  const current = currentIdentity();
  const replacement = replacementIdentity();
  replacement.publicKeyPem = current.publicKeyPem;
  assert.throws(
    () => planJarvisDeviceReplacement({
      nodeId: "android-001",
      currentIdentity: current,
      replacementIdentity: replacement,
      proposedAt: "2026-09-16T04:30:00.000Z",
    }),
    /different public key/,
  );
});

test("device replacement rejects non-canonical timestamps", () => {
  assert.throws(
    () => planJarvisDeviceReplacement({
      nodeId: "android-001",
      currentIdentity: currentIdentity(),
      replacementIdentity: replacementIdentity(),
      proposedAt: "2026-09-16 04:30:00",
    }),
    /ISO timestamp/,
  );
});
