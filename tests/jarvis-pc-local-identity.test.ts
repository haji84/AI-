import assert from "node:assert/strict";
import test from "node:test";
import { ensurePcLocalIdentity, type PcIdentityStorage } from "../src/jarvis/pc-local-identity.ts";
import type { PcEnrollmentApproval } from "../src/jarvis/pc-enrollment.ts";

const now = new Date("2026-10-01T11:18:17Z");
const approval: PcEnrollmentApproval = { version: 1, issue: 1662, goalIssue: 1219,
  approvedAt: now.toISOString(), expiresAt: "2026-10-02T11:18:17Z",
  targets: [{ nodeId: "macbook", platform: "macos" }], roles: ["Executor"] };
function memory() {
  let data: string | undefined;
  let writes = 0;
  const storage: PcIdentityStorage = { read: async () => data, writeExclusive: async value => {
    if (data !== undefined) throw new Error("existing key"); data = value; writes++;
  } };
  return { storage, writes: () => writes, tamper: (value: string) => { data = value; } };
}
test("approved local identity creation is exclusive and retries reuse the same proven key", async () => {
  const m = memory();
  const input = { nodeId: "macbook", platform: "macos" as const, hostBinding: "host-a", approval, storage: m.storage, now };
  const first = await ensurePcLocalIdentity(input);
  const second = await ensurePcLocalIdentity(input);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(m.writes(), 1);
  assert.equal(second.created, false);
  assert.ok(first.privateKeyPem.includes("PRIVATE KEY"));
});
test("wrong host, node or malformed old identity is never replaced", async () => {
  const m = memory();
  const input = { nodeId: "macbook", platform: "macos" as const, hostBinding: "host-a", approval, storage: m.storage, now };
  await ensurePcLocalIdentity(input);
  await assert.rejects(() => ensurePcLocalIdentity({ ...input, hostBinding: "host-b" }), /IDENTITY_CONFLICT/);
  await assert.rejects(() => ensurePcLocalIdentity({ ...input, nodeId: "other" }), /APPROVAL/);
  m.tamper("unreadable private marker");
  await assert.rejects(() => ensurePcLocalIdentity(input), /IDENTITY_CONFLICT/);
  assert.equal(m.writes(), 1);
});
test("expired authorization performs no private identity read or write", async () => {
  const storage: PcIdentityStorage = { read: async () => { assert.fail("must not read"); }, writeExclusive: async () => { assert.fail("must not write"); } };
  await assert.rejects(() => ensurePcLocalIdentity({ nodeId: "macbook", platform: "macos", hostBinding: "host", storage, approval,
    now: new Date("2026-10-02T11:18:17Z") }), /APPROVAL/);
});

test("host file storage publishes one identity atomically and refuses weak permissions or symlinks", { skip: process.platform === "win32" }, async () => {
  const { mkdtemp, mkdir, readFile, chmod, symlink, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FilePcIdentityStorage } = await import("../src/jarvis/pc-local-identity.ts");
  const root = await mkdtemp(join(tmpdir(), "pc-private-"));
  try {
    const path = join(root, "protected", "identity.json"), storage = new FilePcIdentityStorage(path);
    assert.equal(await storage.read(), undefined);
    const outcomes = await Promise.allSettled([storage.writeExclusive("first"), storage.writeExclusive("second")]);
    assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
    const stored = await readFile(path, "utf8");
    assert.ok(["first", "second"].includes(stored));
    assert.equal(await storage.read(), stored);
    assert.deepEqual(await readdir(join(root, "protected")), ["identity.json"]);
    await chmod(path, 0o644);
    await assert.rejects(() => storage.read(), /STORAGE_REJECTED/);
    await chmod(path, 0o600);
    const linkPath = join(root, "protected", "link.json");
    await symlink(path, linkPath);
    await assert.rejects(() => new FilePcIdentityStorage(linkPath).read(), /STORAGE_REJECTED/);
    await mkdir(join(root, "weak"), { mode: 0o755 });
    await assert.rejects(() => new FilePcIdentityStorage(join(root, "weak", "identity.json")).writeExclusive("secret"), /STORAGE_REJECTED/);
    assert.equal(await readFile(path, "utf8"), stored);
  } finally { await rm(root, { recursive: true, force: true }); }
});
