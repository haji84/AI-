import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { JarvisDeviceReplacementTransport } from "../src/jarvis/device-replacement-transport.ts";
import type { JarvisWorkerIdentity } from "../src/jarvis/worker-auth.ts";

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: pair.privateKey,
  };
}

function currentIdentity(nodeId = "android-001"): JarvisWorkerIdentity {
  return {
    nodeId,
    publicKeyPem: keyPair().publicKeyPem,
    algorithm: "ed25519",
    enrolledAt: "2026-09-16T05:00:00.000Z",
  };
}

test("replacement transport reaches only bounded READY_FOR_HUMAN_GATE state", () => {
  const current = currentIdentity();
  const replacement = keyPair();
  const transport = new JarvisDeviceReplacementTransport({
    identityForNode: (nodeId) => nodeId === current.nodeId ? current : undefined,
  });
  const now = new Date("2026-09-16T05:00:00.000Z");
  const challenge = transport.createChallenge({
    nodeId: current.nodeId,
    publicKeyPem: replacement.publicKeyPem,
    algorithm: "ed25519",
    now,
  });
  assert.equal(transport.pendingSize(now), 1);

  const signatureBase64 = sign(null, Buffer.from(challenge.signingPayload, "utf8"), replacement.privateKey).toString("base64");
  const proof = transport.prove({
    candidateId: challenge.candidateId,
    nodeId: current.nodeId,
    signatureBase64,
    now: new Date("2026-09-16T05:00:01.000Z"),
  });

  assert.equal(proof.status, "READY_FOR_HUMAN_GATE");
  assert.equal(proof.requiresHumanGate, true);
  assert.equal(proof.nodeId, current.nodeId);
  assert.ok(!("publicKeyPem" in proof), "untrusted proof response must not echo owner-only key material");
  assert.equal(transport.pendingSize(now), 0);
  assert.equal(transport.readySize(now), 1);

  const ready = transport.listReady(now);
  assert.equal(ready.length, 1);
  assert.equal(ready[0]?.publicKeyPem, replacement.publicKeyPem);
  assert.equal(ready[0]?.requiresHumanGate, true);
  assert.equal(transport.discard(challenge.candidateId), true);
  assert.equal(transport.readySize(now), 0);
});

test("replacement transport rejects unknown worker, wrong proof and replay", () => {
  const current = currentIdentity();
  const replacement = keyPair();
  const attacker = keyPair();
  const transport = new JarvisDeviceReplacementTransport({
    identityForNode: (nodeId) => nodeId === current.nodeId ? current : undefined,
  });
  const now = new Date("2026-09-16T05:00:00.000Z");

  assert.throws(() => transport.createChallenge({
    nodeId: "android-missing",
    publicKeyPem: replacement.publicKeyPem,
    algorithm: "ed25519",
    now,
  }), /current identity not found/);

  const challenge = transport.createChallenge({
    nodeId: current.nodeId,
    publicKeyPem: replacement.publicKeyPem,
    algorithm: "ed25519",
    now,
  });
  const badSignature = sign(null, Buffer.from(challenge.signingPayload, "utf8"), attacker.privateKey).toString("base64");
  assert.throws(() => transport.prove({
    candidateId: challenge.candidateId,
    nodeId: current.nodeId,
    signatureBase64: badSignature,
    now,
  }), /proof is invalid/);

  const goodSignature = sign(null, Buffer.from(challenge.signingPayload, "utf8"), replacement.privateKey).toString("base64");
  transport.prove({ candidateId: challenge.candidateId, nodeId: current.nodeId, signatureBase64: goodSignature, now });
  assert.throws(() => transport.prove({
    candidateId: challenge.candidateId,
    nodeId: current.nodeId,
    signatureBase64: goodSignature,
    now,
  }), /unknown, expired, or already verified/);
});

test("replacement transport stops repeated invalid proof attempts", () => {
  const current = currentIdentity();
  const replacement = keyPair();
  const attacker = keyPair();
  const transport = new JarvisDeviceReplacementTransport({
    identityForNode: (nodeId) => nodeId === current.nodeId ? current : undefined,
  });
  const now = new Date("2026-09-16T05:00:00.000Z");
  const challenge = transport.createChallenge({
    nodeId: current.nodeId,
    publicKeyPem: replacement.publicKeyPem,
    algorithm: "ed25519",
    now,
  });
  const badSignature = sign(null, Buffer.from(challenge.signingPayload, "utf8"), attacker.privateKey).toString("base64");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(() => transport.prove({
      candidateId: challenge.candidateId,
      nodeId: current.nodeId,
      signatureBase64: badSignature,
      now,
    }), /proof is invalid/);
  }
  const goodSignature = sign(null, Buffer.from(challenge.signingPayload, "utf8"), replacement.privateKey).toString("base64");
  assert.throws(() => transport.prove({
    candidateId: challenge.candidateId,
    nodeId: current.nodeId,
    signatureBase64: goodSignature,
    now,
  }), /proof attempt limit reached/);
});

test("replacement transport keeps both challenge and ready-review state time bounded", () => {
  const current = currentIdentity();
  const replacement = keyPair();
  const transport = new JarvisDeviceReplacementTransport({
    identityForNode: (nodeId) => nodeId === current.nodeId ? current : undefined,
  });
  const issuedAt = new Date("2026-09-16T05:00:00.000Z");
  const expiring = transport.createChallenge({
    nodeId: current.nodeId,
    publicKeyPem: replacement.publicKeyPem,
    algorithm: "ed25519",
    ttlMs: 1_000,
    now: issuedAt,
  });
  const signature = sign(null, Buffer.from(expiring.signingPayload, "utf8"), replacement.privateKey).toString("base64");
  assert.throws(() => transport.prove({
    candidateId: expiring.candidateId,
    nodeId: current.nodeId,
    signatureBase64: signature,
    now: new Date("2026-09-16T05:00:02.000Z"),
  }), /unknown, expired, or already verified/);

  const replacement2 = keyPair();
  const challenge = transport.createChallenge({
    nodeId: current.nodeId,
    publicKeyPem: replacement2.publicKeyPem,
    algorithm: "ed25519",
    now: issuedAt,
  });
  const signature2 = sign(null, Buffer.from(challenge.signingPayload, "utf8"), replacement2.privateKey).toString("base64");
  transport.prove({ candidateId: challenge.candidateId, nodeId: current.nodeId, signatureBase64: signature2, now: issuedAt });
  assert.equal(transport.readySize(new Date("2026-09-16T05:09:59.999Z")), 1);
  assert.equal(transport.readySize(new Date("2026-09-16T05:10:00.000Z")), 0);
});
