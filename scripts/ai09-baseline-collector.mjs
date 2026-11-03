import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { TextDecoder } from "node:util";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "../src/orchestrator/resident-runtime-files.ts";

const MAX_OUTPUT = 32_768;
const MAX_TIMEOUT = 10_000;
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configKeys = ["version", "host", "port", "user", "identityFile", "knownHostsFile", "knownHostsSha256", "hostKeyFingerprint", "sshExecutable", "expectedHostname", "expectedMac"];
const executables = ["sshd", "ssh-keygen", "systemctl", "ip", "nft", "ufw", "docker", "podman", "node", "python3"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code, details = {}) => ({ ok: false, status: "BLOCKED", code: `AI09_BASELINE_${code}`, ...details });
const requireValue = (condition, code) => { if (!condition) throw Error(code); };
const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

function ipv4(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) return false;
  return value.split(".").every((part) => Number(part) <= 255);
}

function privateEndpoint(value) {
  if (!ipv4(value)) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function authorityPath(file) {
  requireValue(typeof file === "string" && ![...file].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) && !/[%$~"']/.test(file), "CONFIG_INVALID");
  return assertExternalRuntimePath(file, [workspace]);
}

function metadataOnly(file) {
  const path = authorityPath(file);
  const info = lstatSync(path);
  requireValue(info.isFile() && info.nlink === 1 && info.size > 0, "CONFIG_INVALID");
  return path;
}

function loadConfig(input) {
  requireValue(typeof input.expectedConfigSha256 === "string" && /^[a-f0-9]{64}$/.test(input.expectedConfigSha256), "CONFIG_PIN_REQUIRED");
  const bytes = readBoundedRuntimeFile(authorityPath(input.configPath), 16_384, [workspace]);
  requireValue(sha(bytes) === input.expectedConfigSha256, "CONFIG_PIN_MISMATCH");
  const config = JSON.parse(decode(bytes));
  requireValue(config && Object.getPrototypeOf(config) === Object.prototype && Object.keys(config).length === configKeys.length && configKeys.every((key) => Object.hasOwn(config, key)), "CONFIG_INVALID");
  requireValue(config.version === 1 && config.user === "ai09" && privateEndpoint(config.host), "CONFIG_INVALID");
  requireValue(config.port === 22, "CONFIG_INVALID");
  requireValue(typeof config.expectedHostname === "string" && /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(config.expectedHostname), "CONFIG_INVALID");
  requireValue(typeof config.expectedMac === "string" && /^([a-f0-9]{2}:){5}[a-f0-9]{2}$/.test(config.expectedMac), "CONFIG_INVALID");
  // Identity contents are deliberately never read. The owner must control these paths
  // and their ancestors against replacement for the whole SSH operation.
  config.identityFile = metadataOnly(config.identityFile);
  try {
    config.sshExecutable = metadataOnly(config.sshExecutable);
  } catch (error) {
    if (error?.code === "ENOENT") throw Error("TRANSPORT_MISSING");
    throw error;
  }
  requireValue(/^(ssh|ssh\.exe)$/i.test(basename(config.sshExecutable)), "CONFIG_INVALID");
  try {
    const knownHosts = readBoundedRuntimeFile(authorityPath(config.knownHostsFile), 8192, [workspace]);
    requireValue(/^[a-f0-9]{64}$/.test(config.knownHostsSha256) && sha(knownHosts) === config.knownHostsSha256, "HOST_KEY_INVALID");
    const lines = decode(knownHosts).trim().split(/\r?\n/);
    requireValue(lines.length === 1, "HOST_KEY_INVALID");
    const parts = lines[0].split(/[ \t]+/);
    const endpoint = config.port === 22 ? config.host : `[${config.host}]:${config.port}`;
    requireValue(parts.length === 3 && parts[0] === endpoint && /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))$/.test(parts[1]), "HOST_KEY_INVALID");
    const key = Buffer.from(parts[2], "base64");
    requireValue(key.length > 0 && key.toString("base64") === parts[2], "HOST_KEY_INVALID");
    const fingerprint = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
    requireValue(fingerprint === config.hostKeyFingerprint, "HOST_KEY_INVALID");
  } catch { throw Error("HOST_KEY_INVALID"); }
  return config;
}

function sshArgs(config) {
  const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";
  // OpenSSH parses -o values as config text. Quote spaces and reject all token,
  // environment and quote expansion in authorityPath before reaching this point.
  const knownHosts = config.knownHostsFile.replaceAll("\\", "/");
  const options = [
    "BatchMode=yes", "StrictHostKeyChecking=yes", `UserKnownHostsFile="${knownHosts}"`,
    `GlobalKnownHostsFile=${nullFile}`, "UpdateHostKeys=no", "VerifyHostKeyDNS=no",
    "IdentitiesOnly=yes", "IdentityAgent=none", "ForwardAgent=no", "ForwardX11=no",
    "ClearAllForwardings=yes", "RequestTTY=no", "PasswordAuthentication=no",
    "KbdInteractiveAuthentication=no", "PreferredAuthentications=publickey", "NumberOfPasswordPrompts=0",
    "ConnectionAttempts=1", "ConnectTimeout=5", "ServerAliveInterval=2", "ServerAliveCountMax=2",
    "ControlMaster=no", "ControlPath=none", "ProxyCommand=none", "ProxyJump=none",
    "PermitLocalCommand=no", "KnownHostsCommand=none", "PKCS11Provider=none", "SecurityKeyProvider=none",
  ];
  return ["-F", nullFile, "-T", ...options.flatMap((option) => ["-o", option]), "-i", config.identityFile,
    "-p", String(config.port), `${config.user}@${config.host}`, "ai09-baseline-v1"];
}

function cleanEnv(inherited) {
  const env = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (["systemroot", "windir", "systemdrive", "temp", "tmp", "path"].includes(key.toLowerCase()) && typeof value === "string") env[key] = value;
  }
  env.LANG = "C"; env.LC_ALL = "C";
  return env;
}

function runSsh(config, timeoutMs, spawnImpl, inheritedEnv) {
  return new Promise((finish) => {
    let child, timer, grace, settled = false, code, closeObserved = false, retainedBytes = 0, outputBytes = 0;
    const stdout = [], stderr = [];
    const done = (exitCode = null, signal = null) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(grace);
      if (!closeObserved && child) {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
      }
      const out = Buffer.concat(stdout), err = Buffer.concat(stderr);
      const evidence = { closeObserved, exitCode, signal, outputBytes, retainedBytes, stdoutSha256: sha(out), stderrSha256: sha(err) };
      finish({ ...(code ? fail(code, evidence) : { ok: true, ...evidence }), stdout: out });
    };
    const stop = (reason) => {
      if (settled || code) return; code = reason;
      grace = setTimeout(() => done(), 500);
      try { child?.kill("SIGKILL"); } catch { /* lack of confirmed close remains explicit */ }
    };
    try {
      child = spawnImpl(config.sshExecutable, sshArgs(config), {
        shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: cleanEnv(inheritedEnv),
      });
      const collect = (target, chunk) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputBytes += bytes.length;
        const take = Math.min(bytes.length, MAX_OUTPUT - retainedBytes);
        if (take > 0) { target.push(Buffer.from(bytes.subarray(0, take))); retainedBytes += take; }
        if (outputBytes > MAX_OUTPUT) stop("OUTPUT_LIMIT");
      };
      child.stdout.on("data", (chunk) => collect(stdout, chunk));
      child.stderr.on("data", (chunk) => collect(stderr, chunk));
      child.stdout.on("error", () => stop("OUTPUT_ERROR"));
      child.stderr.on("error", () => stop("OUTPUT_ERROR"));
      child.on("error", (error) => stop(error?.code === "ENOENT" ? "TRANSPORT_MISSING" : "TRANSPORT_ERROR"));
      child.on("close", (exitCode, signal) => {
        closeObserved = true;
        if (!code && (exitCode !== 0 || signal)) code = "REMOTE_FAILED";
        done(exitCode, signal);
      });
      timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
    } catch (error) {
      code = error?.code === "ENOENT" ? "TRANSPORT_MISSING" : "TRANSPORT_ERROR";
      done();
    }
  });
}

function parseBaseline(bytes, config) {
  const lines = decode(bytes).split("\n");
  requireValue(lines.pop() === "" && lines.shift() === "AI09_BASELINE_V1" && lines.pop() === "END_AI09_BASELINE_V1", "RESPONSE_INVALID");
  const single = {}, addresses = [], hostKeys = [], runtime = {};
  for (const line of lines) {
    const equal = line.indexOf("="); requireValue(equal > 0, "RESPONSE_INVALID");
    const key = line.slice(0, equal), value = line.slice(equal + 1);
    requireValue(value.length <= 300 && /^[\x20-\x7e]+$/.test(value), "RESPONSE_INVALID");
    if (key === "ADDRESS") {
      const [ip, prefix, extra] = value.split("/");
      requireValue(ipv4(ip) && /^(0|[1-9]\d?)$/.test(prefix) && Number(prefix) <= 32 && extra === undefined && !addresses.includes(value) && addresses.length < 16, "RESPONSE_INVALID"); addresses.push(value);
    } else if (key === "HOST_KEY") {
      requireValue(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)),SHA256:[A-Za-z0-9+/]{43}$/.test(value) && !hostKeys.includes(value) && hostKeys.length < 3, "RESPONSE_INVALID"); hostKeys.push(value);
    } else if (key === "EXECUTABLE") {
      const [name, state, extra] = value.split(",");
      requireValue(executables.includes(name) && ["present", "missing"].includes(state) && !Object.hasOwn(runtime, name) && extra === undefined, "RESPONSE_INVALID"); runtime[name] = state;
    } else {
      requireValue(["OBSERVED_AT", "ACCOUNT", "UID", "HOSTNAME", "MAC", "SSH_SOCKET", "SSH_SERVICE", "FIREWALL"].includes(key) && !Object.hasOwn(single, key), "RESPONSE_INVALID"); single[key] = value;
    }
  }
  requireValue(Object.keys(single).length === 8 && Object.keys(runtime).length === executables.length, "RESPONSE_INVALID");
  requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(single.OBSERVED_AT) && Number.isFinite(Date.parse(single.OBSERVED_AT)), "RESPONSE_INVALID");
  requireValue(single.ACCOUNT === "ai09" && /^[1-9]\d{0,9}$/.test(single.UID) && single.HOSTNAME === config.expectedHostname && single.MAC === config.expectedMac, "IDENTITY_MISMATCH");
  requireValue(addresses.some((address) => address.split("/")[0] === config.host) && hostKeys.some((key) => key.split(",")[1] === config.hostKeyFingerprint), "IDENTITY_MISMATCH");
  for (const key of ["SSH_SOCKET", "SSH_SERVICE"]) requireValue(single[key] === "unavailable" || /^[a-z-]{1,32},[a-z-]{1,32},[a-z-]{1,32}$/.test(single[key]), "RESPONSE_INVALID");
  requireValue(["readable-policy-not-evaluated", "permission-or-read-unavailable", "executable-missing"].includes(single.FIREWALL), "RESPONSE_INVALID");
  return { observedAt: single.OBSERVED_AT, account: single.ACCOUNT, uid: Number(single.UID), hostname: single.HOSTNAME,
    mac: single.MAC, addresses, sshSocket: single.SSH_SOCKET, sshService: single.SSH_SERVICE, publicHostKeys: hostKeys,
    executables: runtime, firewall: single.FIREWALL };
}

/** Read-only network collection only after a separately approved transport exists.
 * Config and every authority path must be owner-controlled for the entire call.
 * This checks aliases/metadata, not ACL ownership or hostile-principal isolation.
 */
export async function collectAi09Baseline(input = {}, { spawnImpl = spawn, inheritedEnv = process.env } = {}) {
  if (!input.configPath) return fail("UNCONFIGURED", { reason: "AUTHENTICATED_GUEST_TRANSPORT_NOT_PROVISIONED" });
  let config;
  try {
    requireValue(input.timeoutMs === undefined || (Number.isInteger(input.timeoutMs) && input.timeoutMs >= 1 && input.timeoutMs <= MAX_TIMEOUT), "CONFIG_INVALID");
    config = loadConfig(input);
  } catch (error) {
    const allowed = ["CONFIG_PIN_REQUIRED", "CONFIG_PIN_MISMATCH", "CONFIG_INVALID", "HOST_KEY_INVALID", "TRANSPORT_MISSING"];
    return fail(allowed.includes(error?.message) ? error.message : "CONFIG_INVALID");
  }
  const result = await runSsh(config, input.timeoutMs ?? MAX_TIMEOUT, spawnImpl, inheritedEnv);
  const { stdout, ...evidence } = result;
  if (!result.ok) return evidence;
  try {
    const baseline = parseBaseline(stdout, config);
    return { ...evidence, status: "COLLECTED", code: "AI09_BASELINE_COLLECTED", configSha256: input.expectedConfigSha256, baseline };
  } catch (error) {
    return fail(error?.message === "IDENTITY_MISMATCH" ? "IDENTITY_MISMATCH" : "RESPONSE_INVALID", { ...evidence, ok: false });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const result = args.length === 0 ? await collectAi09Baseline() : args.length === 2
    ? await collectAi09Baseline({ configPath: args[0], expectedConfigSha256: args[1] }) : fail("CONFIG_INVALID");
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
