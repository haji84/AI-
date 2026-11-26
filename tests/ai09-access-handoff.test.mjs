import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { collectAi09Baseline } from "../scripts/ai09-baseline-collector.mjs";

const source = resolve("scripts/ai09-access-handoff.mjs");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const now = Date.parse("2026-10-19T03:04:05.000Z");
const blob = Buffer.concat([Buffer.from("0000000b7373682d6564323535313900000020", "hex"), Buffer.alloc(32, 7)]);
const publicHostKey = `ssh-ed25519 ${blob.toString("base64")}`;
const fingerprint = `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;

async function api() {
  assert.ok(existsSync(source), "the bounded access handoff compiler is missing");
  return import("../scripts/ai09-access-handoff.mjs");
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ai09-handoff-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const host = {
    status: "APPLIED", version: 1, issue: 1219, planSha256: "a".repeat(64), hostName: "HAJI",
    vmId: "453b139b-cceb-446e-99fb-f45bf5895436", nicMac: "00155DDC2C00",
    hostAddress: "172.27.128.1", guestAddress: "172.27.140.2", expiresAt: "2026-10-19T04:04:05.0000000+00:00",
    baselineSha256: "b".repeat(64), afterSha256: "c".repeat(64), observedAt: "2026-10-19T03:04:04.1234567+00:00",
  };
  const guest = {
    status: "APPLIED", planSha256: "d".repeat(64), hostAddress: host.hostAddress, guestAddress: host.guestAddress,
    hostname: "fixture-ai09", nicMac: "00:15:5d:dc:2c:00", publicHostKey, hostKeyFingerprint: fingerprint,
    expiresAt: "2026-10-19T03:34:05.000Z", observedAt: "2026-10-19T03:04:04.000Z",
    baselineSha256: "e".repeat(64), afterSha256: "f".repeat(64),
  };
  const input = {
    version: 1, hostReceiptPath: join(root, "host.json"), hostReceiptSha256: "",
    guestReceiptPath: join(root, "guest.json"), guestReceiptSha256: "",
    identityFile: join(root, "client-identity.fixture"), sshExecutable: join(root, process.platform === "win32" ? "ssh.exe" : "ssh"),
    configOutput: join(root, "collector.json"), knownHostsOutput: join(root, "known hosts"),
  };
  // These are inert public test data, never real credentials or an executable.
  writeFileSync(input.identityFile, "metadata-only fixture, deliberately not a private key");
  writeFileSync(input.sshExecutable, "must never execute");
  const save = () => {
    for (const [which, value] of [["host", host], ["guest", guest]]) {
      const bytes = JSON.stringify(value); writeFileSync(input[`${which}ReceiptPath`], bytes); input[`${which}ReceiptSha256`] = sha(bytes);
    }
    return input;
  };
  save();
  return { root, host, guest, input, save };
}

function noOutputs(input) {
  assert.equal(existsSync(input.configOutput), false); assert.equal(existsSync(input.knownHostsOutput), false);
}

test("pinned activation receipts prepare collector-compatible files without claiming authentication", async (t) => {
  const { prepareAi09AccessHandoff } = await api(); const { input } = fixture(t);
  const result = prepareAi09AccessHandoff(input, { now });
  assert.equal(result.status, "PREPARED"); assert.equal(result.ok, true);
  assert.equal(result.authenticatedConnectionVerified, false);
  assert.equal(result.expiresAt, "2026-10-19T03:34:05.000Z");
  assert.equal(result.configSha256, sha(readFileSync(input.configOutput)));
  assert.equal(result.knownHostsSha256, sha(readFileSync(input.knownHostsOutput)));
  assert.equal(readFileSync(input.knownHostsOutput, "utf8"), `172.27.140.2 ${publicHostKey}\n`);
  const config = JSON.parse(readFileSync(input.configOutput, "utf8"));
  assert.deepEqual(config, {
    version: 1, host: "172.27.140.2", port: 22, user: "ai09", identityFile: input.identityFile,
    knownHostsFile: input.knownHostsOutput, knownHostsSha256: result.knownHostsSha256, hostKeyFingerprint: fingerprint,
    sshExecutable: input.sshExecutable, expectedHostname: "fixture-ai09", expectedMac: "00:15:5d:dc:2c:00",
  });
  let transportCalls = 0;
  const accepted = await collectAi09Baseline({ configPath: input.configOutput, expectedConfigSha256: result.configSha256 }, {
    spawnImpl: () => { transportCalls++; throw Object.assign(Error("controlled missing transport"), { code: "ENOENT" }); },
  });
  assert.equal(accepted.code, "AI09_BASELINE_TRANSPORT_MISSING"); assert.equal(transportCalls, 1);
});

test("an independently pinned receipt mismatch refuses before creating files", async (t) => {
  const { prepareAi09AccessHandoff } = await api();
  for (const which of ["host", "guest"]) {
    const { input } = fixture(t); input[`${which}ReceiptSha256`] = "0".repeat(64);
    const result = prepareAi09AccessHandoff(input, { now });
    assert.equal(result.ok, false); assert.match(result.code, /PIN_MISMATCH$/); noOutputs(input);
  }
});

test("failed, extra-field or mismatched-scope receipts cannot prepare access", async (t) => {
  const { prepareAi09AccessHandoff } = await api();
  for (const [side, field, value] of [
    ["host", "status", "UNCERTAIN"], ["guest", "status", "OBSERVED"], ["host", "issue", 2], ["host", "hostName", "OTHER"],
    ["host", "vmId", "453b139b-cceb-446e-99fb-f45bf5895437"], ["host", "nicMac", "00155DDC2C01"],
    ["guest", "nicMac", "00:15:5d:dc:2c:01"], ["guest", "hostAddress", "172.27.128.2"],
    ["guest", "guestAddress", "172.27.140.3"], ["host", "guestAddress", "203.0.113.2"],
    ["guest", "baselineSha256", "not-a-hash"], ["host", "afterSha256", null], ["guest", "hostname", "bad\nname"],
    ["host", "fixture", true], ["guest", "authenticatedConnectionVerified", true],
  ]) {
    const f = fixture(t); f[side][field] = value; f.save();
    const result = prepareAi09AccessHandoff(f.input, { now });
    assert.equal(result.ok, false, `${side}.${field}`); noOutputs(f.input);
  }
});

test("stale, future, invalid or expired receipt leases cannot prepare files", async (t) => {
  const { prepareAi09AccessHandoff } = await api();
  for (const side of ["host", "guest"]) for (const [field, value] of [
    ["observedAt", "2026-10-19T02:49:04.999Z"], ["observedAt", "2026-10-19T03:04:05.001Z"],
    ["observedAt", "2026-02-30T03:04:05.000Z"], ["expiresAt", "2026-10-19T03:04:05.000Z"],
    ["expiresAt", "2026-10-20T03:04:05.001Z"], ["expiresAt", "tomorrow"],
  ]) {
    const f = fixture(t); f[side][field] = value; f.save();
    assert.equal(prepareAi09AccessHandoff(f.input, { now }).ok, false, `${side}.${field}=${value}`); noOutputs(f.input);
  }
});

test("the exact Ed25519 public key structure and fingerprint are required", async (t) => {
  const { prepareAi09AccessHandoff } = await api();
  for (const changes of [
    { publicHostKey: `ssh-ed25519 ${Buffer.from("arbitrary").toString("base64")}` },
    { publicHostKey: publicHostKey.replace("ssh-ed25519", "ssh-rsa") },
    { publicHostKey: publicHostKey + "\nother-host key" }, { hostKeyFingerprint: "SHA256:" + "A".repeat(43) },
  ]) {
    const f = fixture(t); Object.assign(f.guest, changes); f.save();
    assert.equal(prepareAi09AccessHandoff(f.input, { now }).ok, false); noOutputs(f.input);
  }
});

test("authority paths reject aliases, repository input, missing metadata and output collisions", async (t) => {
  const { prepareAi09AccessHandoff } = await api();
  for (const change of [
    (f) => { f.input.identityFile = resolve("package.json"); },
    (f) => { f.input.identityFile = "relative-key"; },
    (f) => { f.input.sshExecutable = join(f.root, "missing", "ssh"); },
    (f) => { f.input.knownHostsOutput = f.input.configOutput; },
    (f) => { const alias = join(f.root, "alias.json"); linkSync(f.input.guestReceiptPath, alias); },
    (f) => { f.input.configOutput = join(f.root, "%EXPANSION%", "config"); },
  ]) {
    const f = fixture(t); change(f);
    assert.equal(prepareAi09AccessHandoff(f.input, { now }).ok, false); noOutputs(f.input);
  }
});

test("a receipt aliasing the client identity is rejected before opening receipt contents", async (t) => {
  const { prepareAi09AccessHandoff } = await api(); const { input } = fixture(t);
  input.hostReceiptPath = input.identityFile;
  const result = prepareAi09AccessHandoff(input, { now });
  assert.equal(result.code, "AI09_HANDOFF_PATH_COLLISION"); noOutputs(input);
});

test("existing destinations are preserved and prevent both writes", async (t) => {
  const { prepareAi09AccessHandoff } = await api();
  for (const which of ["configOutput", "knownHostsOutput"]) {
    const { input } = fixture(t); writeFileSync(input[which], "owner's original bytes");
    const result = prepareAi09AccessHandoff(input, { now });
    assert.equal(result.ok, false); assert.equal(readFileSync(input[which], "utf8"), "owner's original bytes");
    assert.equal(existsSync(input[which === "configOutput" ? "knownHostsOutput" : "configOutput"]), false);
  }
});

test("partial output failure retains and reports only the exact created file", async (t) => {
  const { prepareAi09AccessHandoff } = await api(); const { input } = fixture(t);
  const result = prepareAi09AccessHandoff(input, { now, writeExclusive: (path, bytes) => {
    if (path === input.configOutput) throw Object.assign(Error("fixture disk failure"), { code: "EIO" });
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  } });
  assert.equal(result.status, "BLOCKED"); assert.equal(result.authenticatedConnectionVerified, false);
  assert.deepEqual(result.createdOutputs, [{ path: input.knownHostsOutput, sha256: sha(readFileSync(input.knownHostsOutput)) }]);
  assert.equal(result.unconfirmedOutput, input.configOutput); assert.equal(existsSync(input.configOutput), false);
});

test("CLI requires the external request's independent SHA256 pin before any write", async (t) => {
  await api(); const f = fixture(t); const request = join(f.root, "request.json"); writeFileSync(request, JSON.stringify(f.input));
  const result = spawnSync(process.execPath, [source, request, "0".repeat(64)], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, "BLOCKED"); noOutputs(f.input);
});
