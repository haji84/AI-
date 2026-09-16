import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { JarvisDeviceReplacementCandidateManager } from "../src/jarvis/device-replacement-candidate.ts";
import type { JarvisWorkerIdentity } from "../src/jarvis/worker-auth.ts";

function ed25519() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: pair.privateKey,
  };
}

function identity(nodeId = "android-001"): JarvisWorkerIdentity & { privateKey: ReturnType<typeof ed25519>["privateKey"] } {
  const pair = ed25519();
  return {
    nodeId,
    publicKeyPem: pair.publicKeyPem,
    privateKey: pair.privateKey,
    algorithm: "ed25519",
    enrolledAt: "2026-09-16T00:00:00.000Z",
  };
}

test("replacement candidate proves key possession exactly once before Human Gate", () => {
  const current = identity();
  const replacement = ed25519();
  const manager = new JarvisDeviceReplacementCandidateManager();
  const now = new Date("2026-09-16T04:00:00.000Z");
  const challenge = manager.create({
    currentIdentity: current,
    replacement: { nodeId: current.nodeId, publicKeyPem: replacement.publicKeyPem, algorithm: "ed25519" },
    now,
  });

  assert.equal(challenge.nodeId, current.nodeId);
  assert.equal(challenge.algorithm, "ed25519");
  assert.ok(!("publicKeyPem" in challenge));
  assert.equal(manager.size(now), 1);

  const signatureBase64 = sign(null, Buffer.from(challenge.signingPayload, "utf8"), replacement.privateKey).toString("base64");
  const verified = manager.verify({ candidateId: challenge.candidateId, nodeId: current.nodeId, signatureBase64, now: new Date("2026-09-16T04:00:01.000Z") });
  assert.equal(verified.status, "READY_FOR_HUMAN_GATE");
  assert.equal(verified.requiresHumanGate, true);
  assert.equal(verified.publicKeyPem, replacement.publicKeyPem);
  assert.equal(manager.size(now), 0);
  assert.throws(() => manager.verify({ candidateId: challenge.candidateId, nodeId: current.nodeId, signatureBase64, now }), /unknown, expired, or already verified/);
});

test("replacement candidate rejects wrong proof, node mismatch, same key and expiry", () => {
  const current = identity();
  const replacement = ed25519();
  const attacker = ed25519();
  const manager = new JarvisDeviceReplacementCandidateManager();
  const now = new Date("2026-09-16T04:00:00.000Z");
  const challenge = manager.create({
    currentIdentity: current,
    replacement: { nodeId: current.nodeId, publicKeyPem: replacement.publicKeyPem, algorithm: "ed25519" },
    now,
    ttlMs: 1_000,
  });
  const attackerSignature = sign(null, Buffer.from(challenge.signingPayload, "utf8"), attacker.privateKey).toString("base64");
  assert.throws(() => manager.verify({ candidateId: challenge.candidateId, nodeId: current.nodeId, signatureBase64: attackerSignature, now }), /proof is invalid/);
  assert.throws(() => manager.verify({ candidateId: challenge.candidateId, nodeId: "android-002", signatureBase64: attackerSignature, now }), /node mismatch/);
  assert.throws(() => manager.verify({ candidateId: challenge.candidateId, nodeId: current.nodeId, signatureBase64: attackerSignature, now: new Date("2026-09-16T04:00:02.000Z") }), /unknown, expired, or already verified/);

  assert.throws(() => manager.create({
    currentIdentity: current,
    replacement: { nodeId: current.nodeId, publicKeyPem: current.publicKeyPem, algorithm: "ed25519" },
    now,
  }), /different public key/);
  assert.throws(() => manager.create({
    currentIdentity: current,
    replacement: { nodeId: "android-002", publicKeyPem: replacement.publicKeyPem, algorithm: "ed25519" },
    now,
  }), /does not match current identity/);
});

test("replacement candidate validates ECDSA P-256 proof and bounded pending capacity", () => {
  const current = identity();
  const replacement = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const replacementPublic = replacement.publicKey.export({ type: "spki", format: "pem" }).toString();
  const manager = new JarvisDeviceReplacementCandidateManager(1);
  const now = new Date("2026-09-16T04:00:00.000Z");
  const challenge = manager.create({
    currentIdentity: current,
    replacement: { nodeId: current.nodeId, publicKeyPem: replacementPublic, algorithm: "ecdsa-p256-sha256" },
    now,
  });
  assert.throws(() => manager.create({
    currentIdentity: identity("android-002"),
    replacement: { nodeId: "android-002", publicKeyPem: ed25519().publicKeyPem, algorithm: "ed25519" },
    now,
  }), /capacity reached/);
  const signatureBase64 = sign("sha256", Buffer.from(challenge.signingPayload, "utf8"), replacement.privateKey).toString("base64");
  const verified = manager.verify({ candidateId: challenge.candidateId, nodeId: current.nodeId, signatureBase64, now });
  assert.equal(verified.algorithm, "ecdsa-p256-sha256");
});
