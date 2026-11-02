import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { collectAi09Baseline } from "../scripts/ai09-baseline-collector.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const publicBlob = Buffer.from("fixture-public-host-key");
const fingerprint = `SHA256:${createHash("sha256").update(publicBlob).digest("base64").replace(/=+$/, "")}`;
const baseline = [
  "AI09_BASELINE_V1", "OBSERVED_AT=2026-10-19T03:04:05Z", "ACCOUNT=ai09", "UID=1000",
  "HOSTNAME=fixture-guest", "MAC=00:15:5d:dc:2c:00", "ADDRESS=192.168.64.9/24",
  "SSH_SOCKET=loaded,active,listening", "SSH_SERVICE=loaded,inactive,dead",
  `HOST_KEY=ssh-ed25519,${fingerprint}`, "EXECUTABLE=sshd,present", "EXECUTABLE=ssh-keygen,present",
  "EXECUTABLE=systemctl,present", "EXECUTABLE=ip,present", "EXECUTABLE=nft,present", "EXECUTABLE=ufw,missing",
  "EXECUTABLE=docker,missing", "EXECUTABLE=podman,missing", "EXECUTABLE=node,missing", "EXECUTABLE=python3,present",
  "FIREWALL=permission-or-read-unavailable", "END_AI09_BASELINE_V1", "",
].join("\n");

function fixture(t, changes = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ai09-baseline-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const identityFile = join(dir, "identity.fixture");
  const knownHostsFile = join(dir, "known hosts.fixture");
  const sshExecutable = join(dir, process.platform === "win32" ? "ssh.exe" : "ssh");
  writeFileSync(identityFile, "not-a-private-key: metadata only");
  writeFileSync(sshExecutable, "not executed: subprocess boundary double");
  const knownHosts = `192.168.64.9 ssh-ed25519 ${publicBlob.toString("base64")}\n`;
  writeFileSync(knownHostsFile, knownHosts);
  const config = {
    version: 1, host: "192.168.64.9", port: 22, user: "ai09", identityFile,
    knownHostsFile, knownHostsSha256: sha(knownHosts), hostKeyFingerprint: fingerprint,
    sshExecutable, expectedHostname: "fixture-guest", expectedMac: "00:15:5d:dc:2c:00", ...changes,
  };
  const configPath = join(dir, "owner-config.json");
  const bytes = JSON.stringify(config);
  writeFileSync(configPath, bytes);
  return { configPath, expectedConfigSha256: sha(bytes), config };
}

function transport(action, calls = []) {
  return (file, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = (signal) => { calls.push({ killed: signal }); Promise.resolve().then(() => child.emit("close", null, signal)); return true; };
    calls.push({ file, args, options });
    Promise.resolve().then(() => action(child));
    return child;
  };
}

test("unconfigured collection fails visibly without starting any transport", async () => {
  let calls = 0;
  const result = await collectAi09Baseline({}, { spawnImpl: () => { calls++; } });
  assert.equal(result.code, "AI09_BASELINE_UNCONFIGURED");
  assert.equal(result.ok, false); assert.equal(calls, 0);
});

test("a mismatched independent owner config pin cannot launch SSH", async (t) => {
  const input = fixture(t); let calls = 0;
  const result = await collectAi09Baseline({ ...input, expectedConfigSha256: "0".repeat(64) }, { spawnImpl: () => { calls++; } });
  assert.equal(result.code, "AI09_BASELINE_CONFIG_PIN_MISMATCH"); assert.equal(calls, 0);
});

test("the exact host-key-pinned endpoint runs only the fixed verb with no ambient SSH authority", async (t) => {
  const input = fixture(t); const calls = [];
  const result = await collectAi09Baseline(input, { spawnImpl: transport((child) => {
    child.stdout.end(baseline); child.emit("close", 0, null);
  }, calls), inheritedEnv: { PATH: "trusted-path", SSH_AUTH_SOCK: "ambient-agent", SSH_ASKPASS: "bad", NODE_OPTIONS: "bad", DISPLAY: "bad" } });
  assert.equal(result.ok, true); assert.equal(result.code, "AI09_BASELINE_COLLECTED");
  assert.equal(result.baseline.hostname, "fixture-guest");
  assert.equal(result.baseline.firewall, "permission-or-read-unavailable");
  assert.equal(result.closeObserved, true); assert.equal(calls.length, 1);
  const call = calls[0]; assert.equal(call.file, input.config.sshExecutable);
  assert.deepEqual(call.args.slice(-2), ["ai09@192.168.64.9", "ai09-baseline-v1"]);
  for (const option of ["BatchMode=yes", "StrictHostKeyChecking=yes", "IdentityAgent=none", "ForwardAgent=no", "RequestTTY=no", "PasswordAuthentication=no", "KbdInteractiveAuthentication=no", "ProxyCommand=none", "ProxyJump=none", "PermitLocalCommand=no", "KnownHostsCommand=none", "ConnectionAttempts=1"]) {
    assert.ok(call.args.includes(option), option);
  }
  assert.ok(call.args.includes("-F")); assert.ok(call.args.includes("-T"));
  assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  for (const key of ["SSH_AUTH_SOCK", "SSH_ASKPASS", "NODE_OPTIONS", "DISPLAY"]) assert.equal(call.options.env[key], undefined);
});

test("changed known_hosts, wrong account, arbitrary hostname and extra config authority fail before SSH", async (t) => {
  for (const changes of [{ user: "root" }, { host: "guest.example.com" }, { command: "id" }, { port: 8797 }, { hostKeyFingerprint: `SHA256:${"A".repeat(43)}` }]) {
    const input = fixture(t, changes); let calls = 0;
    const result = await collectAi09Baseline(input, { spawnImpl: () => { calls++; } });
    assert.equal(result.ok, false); assert.equal(calls, 0);
  }
  const input = fixture(t); writeFileSync(input.config.knownHostsFile, "changed\n");
  const result = await collectAi09Baseline(input, { spawnImpl: () => { assert.fail("must not spawn"); } });
  assert.equal(result.code, "AI09_BASELINE_HOST_KEY_INVALID");
});

test("a missing transport yields a structured failure and no retry", async (t) => {
  const input = fixture(t); let calls = 0;
  const result = await collectAi09Baseline(input, { spawnImpl: () => { calls++; throw Object.assign(Error("missing"), { code: "ENOENT" }); } });
  assert.equal(result.code, "AI09_BASELINE_TRANSPORT_MISSING"); assert.equal(calls, 1);
});

test("the wall deadline kills the single SSH process and cannot return a collected baseline", async (t) => {
  const calls = [];
  const result = await collectAi09Baseline({ ...fixture(t), timeoutMs: 15 }, { spawnImpl: transport(() => {}, calls) });
  assert.equal(result.code, "AI09_BASELINE_TIMEOUT"); assert.equal(result.ok, false);
  assert.equal(result.closeObserved, true); assert.equal(calls.filter((call) => call.killed).length, 1);
});

test("combined output exceeding 32 KiB kills transport and never retains unbounded text", async (t) => {
  const calls = [];
  const result = await collectAi09Baseline(fixture(t), { spawnImpl: transport((child) => {
    child.stdout.write("x".repeat(20_000)); child.stderr.write("y".repeat(20_000));
  }, calls) });
  assert.equal(result.code, "AI09_BASELINE_OUTPUT_LIMIT"); assert.equal(result.ok, false);
  assert.ok(result.retainedBytes <= 32_768); assert.equal(calls.filter((call) => call.killed).length, 1);
  assert.ok(JSON.stringify(result).length < 2000);
});

test("wrong guest identity, malformed output or nonzero remote exit cannot become a baseline", async (t) => {
  for (const [output, exitCode] of [[baseline.replace("fixture-guest", "other-guest"), 0], [baseline.replace("192.168.64.9/24", "192.168.64.8/24"), 0], [baseline.replace("permission-or-read-unavailable", "disabled"), 0], [baseline + "UNEXPECTED=value\n", 0], [baseline, 7]]) {
    const result = await collectAi09Baseline(fixture(t), { spawnImpl: transport((child) => { child.stdout.end(output); child.emit("close", exitCode, null); }) });
    assert.equal(result.ok, false);
  }
});

test("a transport that cannot confirm close stays uncertain after its deadline", async (t) => {
  let child, unreferenced = false;
  const result = await collectAi09Baseline({ ...fixture(t), timeoutMs: 10 }, { spawnImpl: () => {
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => false; child.unref = () => { unreferenced = true; }; return child;
  } });
  assert.equal(result.ok, false); assert.equal(result.closeObserved, false);
  assert.equal(result.code, "AI09_BASELINE_TIMEOUT");
  assert.equal(child.stdout.destroyed, true); assert.equal(child.stderr.destroyed, true); assert.equal(unreferenced, true);
});

test("incomplete runtime observations cannot be reported as a collected baseline", async (t) => {
  const result = await collectAi09Baseline(fixture(t), { spawnImpl: transport((child) => {
    child.stdout.end(baseline.replace("EXECUTABLE=docker,missing\n", "")); child.emit("close", 0, null);
  }) });
  assert.equal(result.code, "AI09_BASELINE_RESPONSE_INVALID"); assert.equal(result.ok, false);
});

test("output stream errors terminate the transport and remain structured failures", async (t) => {
  const result = await collectAi09Baseline(fixture(t), { spawnImpl: transport((child) => {
    child.stdout.emit("error", Error("fixture stream error"));
  }) });
  assert.equal(result.code, "AI09_BASELINE_OUTPUT_ERROR"); assert.equal(result.ok, false);
  assert.equal(result.closeObserved, true);
});

test("a larger deadline is rejected and the unconfigured CLI returns machine-readable BLOCKED", async (t) => {
  const result = await collectAi09Baseline({ ...fixture(t), timeoutMs: 10_001 }, { spawnImpl: () => { assert.fail("must not spawn"); } });
  assert.equal(result.code, "AI09_BASELINE_CONFIG_INVALID");
  const cli = spawnSync(process.execPath, [resolve("scripts/ai09-baseline-collector.mjs")], { encoding: "utf8", timeout: 2000 });
  assert.equal(cli.status, 1);
  assert.deepEqual(JSON.parse(cli.stdout), { ok: false, status: "BLOCKED", code: "AI09_BASELINE_UNCONFIGURED", reason: "AUTHENTICATED_GUEST_TRANSPORT_NOT_PROVISIONED" });
});

test("the first access gate cannot expand its authority to a non-SSH listener port", async (t) => {
  const input = fixture(t, { port: 443 });
  const hostLine = `[192.168.64.9]:443 ssh-ed25519 ${publicBlob.toString("base64")}\n`;
  writeFileSync(input.config.knownHostsFile, hostLine);
  input.config.knownHostsSha256 = sha(hostLine);
  const bytes = JSON.stringify(input.config); writeFileSync(input.configPath, bytes);
  input.expectedConfigSha256 = sha(bytes);
  let calls = 0;
  const result = await collectAi09Baseline(input, { spawnImpl: transport((child) => { calls++; child.stdout.end(baseline); child.emit("close", 0, null); }) });
  assert.equal(result.code, "AI09_BASELINE_CONFIG_INVALID"); assert.equal(calls, 0);
});

test("the guest gate has valid shell syntax and rejects arbitrary commands without executing them", (t) => {
  const gate = resolve("scripts/ai09-baseline-command-gate.sh");
  assert.ok(existsSync(gate), "the fixed guest gate must be supplied");
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/bash";
  if (!existsSync(bash)) { t.skip("bash unavailable: no physical Linux claim"); return; }
  const syntax = spawnSync(bash, ["--noprofile", "--norc", "-n", gate], { encoding: "utf8", timeout: 2000 });
  assert.equal(syntax.status, 0, syntax.stderr);
  const outcome = spawnSync(bash, ["--noprofile", "--norc", gate], { env: { ...process.env, SSH_ORIGINAL_COMMAND: "ai09-baseline-v1; echo UNAUTHORIZED", BASH_ENV: "", ENV: "" }, encoding: "utf8", timeout: 2000 });
  assert.equal(outcome.status, 64); assert.equal(outcome.stdout, ""); assert.match(outcome.stderr, /AI09_COMMAND_REFUSED/);
  assert.equal(readFileSync(gate, "utf8").includes("\r"), false, "guest source must remain LF");
});
