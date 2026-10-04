import assert from "node:assert/strict";
import test from "node:test";
import { chmod, link, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const renewalTime = new Date("2026-10-04T15:00:00Z");
const renewedScope = { ...scope, approvedAt: "2026-10-04T14:49:15Z", expiresAt: "2026-10-05T14:49:15Z" };

async function approvalFixture(run: (path: string, directory: string, original: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "pc-approval-test-"));
  const path = join(directory, "approval.json"), original = JSON.stringify(scope, null, 2);
  try {
    await chmod(directory, 0o700);
    await writeFile(path, original, { mode: 0o600 });
    await run(path, directory, original);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("protected approval renewal backs up before writing and preserves file identity permissions and keys", async () => {
  await approvalFixture(async (path, directory, original) => {
    const keyPath = join(directory, "identity.json");
    await writeFile(keyPath, "host-held-key-fixture", { mode: 0o600 });
    const before = await stat(path); let backups = 0;
    const backup = async (text: string) => {
      assert.equal(await readFile(path, "utf8"), original);
      assert.equal(text, original); backups++;
    };
    assert.equal(await pcApproval.renewPcApprovalFile({ path, approval: renewedScope, now: renewalTime, backup }), true);
    const after = await stat(path);
    assert.deepEqual([after.ino, after.dev, after.mode, after.uid], [before.ino, before.dev, before.mode, before.uid]);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), renewedScope);
    assert.equal(await readFile(keyPath, "utf8"), "host-held-key-fixture");
    assert.equal(await pcApproval.renewPcApprovalFile({ path, approval: renewedScope, now: renewalTime, backup }), false);
    assert.equal(backups, 1);
  });
});

test("approval renewal rejects changed authority and failed backup without changing the existing file", async () => {
  await approvalFixture(async (path, _directory, original) => {
    let backups = 0;
    await assert.rejects(pcApproval.renewPcApprovalFile({ path, approval: { ...renewedScope, goalIssue: 681 },
      now: renewalTime, backup: async () => { backups++; } }), /CONFLICT/);
    assert.equal(backups, 0);
    await assert.rejects(pcApproval.renewPcApprovalFile({ path, approval: renewedScope, now: renewalTime,
      backup: async () => { throw new Error("BACKUP_FAILED"); } }), /BACKUP_FAILED/);
    assert.equal(await readFile(path, "utf8"), original);
  });
});

test("approval renewal rejects a file changed while its backup is taken", async () => {
  await approvalFixture(async (path) => {
    await assert.rejects(pcApproval.renewPcApprovalFile({ path, approval: renewedScope, now: renewalTime,
      backup: async () => { await writeFile(path, "external-change"); } }), /CONFLICT/);
    assert.equal(await readFile(path, "utf8"), "external-change");
  });
});

test("approval renewal rejects linked and permissive files", { skip: process.platform === "win32" }, async () => {
  await approvalFixture(async (path, directory, original) => {
    const alias = join(directory, "alias.json");
    await symlink(path, alias);
    const renew = (target: string) => pcApproval.renewPcApprovalFile({ path: target, approval: renewedScope,
      now: renewalTime, backup: async () => { throw new Error("UNEXPECTED_BACKUP"); } });
    await assert.rejects(renew(alias), /CONFLICT/); await rm(alias);
    await link(path, alias);
    await assert.rejects(renew(path), /CONFLICT/); await rm(alias);
    await chmod(path, 0o640); await assert.rejects(renew(path), /CONFLICT/); await chmod(path, 0o600);
    await chmod(directory, 0o770); await assert.rejects(renew(path), /CONFLICT/); await chmod(directory, 0o700);
    assert.equal(await readFile(path, "utf8"), original);
  });
});

test("overlapping approval renewals cannot overwrite or roll back another successful update", async () => {
  await approvalFixture(async (path, _directory, original) => {
    let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const backedUp = new Promise<void>(resolve => { entered = resolve; });
    const first = pcApproval.renewPcApprovalFile({ path, approval: renewedScope, now: renewalTime,
      backup: async text => { assert.equal(text, original); entered(); await blocked; } });
    try {
      await backedUp;
      await assert.rejects(pcApproval.renewPcApprovalFile({ path, approval: renewedScope, now: renewalTime,
        backup: async () => { throw new Error("UNEXPECTED_BACKUP"); } }), /PC_LOCAL_APPROVAL_BUSY/);
    } finally { release(); }
    assert.equal(await first, true);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), renewedScope);
    assert.equal(await pcApproval.renewPcApprovalFile({ path, approval: renewedScope, now: renewalTime,
      backup: async () => { throw new Error("UNEXPECTED_BACKUP"); } }), false);
  });
});
