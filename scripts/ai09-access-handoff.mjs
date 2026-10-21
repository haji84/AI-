import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, openSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "../src/orchestrator/resident-runtime-files.ts";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[a-f0-9]{64}$/;
const MAC = "00:15:5d:dc:2c:00";
const VM = "453b139b-cceb-446e-99fb-f45bf5895436";
const commonReceiptKeys = ["status", "planSha256", "hostAddress", "guestAddress", "expiresAt", "observedAt", "baselineSha256", "afterSha256"];
const hostKeys = [...commonReceiptKeys, "version", "issue", "hostName", "vmId", "nicMac"];
const guestKeys = [...commonReceiptKeys, "hostname", "nicMac", "publicHostKey", "hostKeyFingerprint"];
const requestKeys = ["version", "hostReceiptPath", "hostReceiptSha256", "guestReceiptPath", "guestReceiptSha256", "identityFile", "sshExecutable", "configOutput", "knownHostsOutput"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requireValue = (value, code) => { if (!value) throw Error(code); };

function exact(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function external(file) {
  requireValue(typeof file === "string" && ![...file].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && !/[%$~"']/.test(file), "PATH_INVALID");
  return assertExternalRuntimePath(file, [workspace]);
}

function metadataOnly(file) {
  const path = external(file), info = lstatSync(path);
  requireValue(info.isFile() && info.nlink === 1 && info.size > 0, "CLIENT_PATH_INVALID");
  return path;
}

function readPinned(file, pin, maxBytes) {
  requireValue(typeof pin === "string" && SHA.test(pin), "PIN_REQUIRED");
  const bytes = readBoundedRuntimeFile(external(file), maxBytes, [workspace]);
  requireValue(sha(bytes) === pin, "PIN_MISMATCH");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function privateAddress(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) return false;
  const [a, b, c, d] = value.split(".").map(Number);
  return [a, b, c, d].every((part) => part <= 255) && (a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168);
}

function utcTime(value) {
  // PowerShell DateTimeOffset's round-trip form has seven fractional digits;
  // Python's guest receipt has milliseconds. Both must explicitly mean UTC.
  requireValue(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,7}(Z|\+00:00)$/.test(value), "RECEIPT_TIME_INVALID");
  const ms = Date.parse(value);
  requireValue(Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 23) === value.slice(0, 23), "RECEIPT_TIME_INVALID");
  return ms;
}

function receipt(value, keys, now) {
  requireValue(exact(value, keys) && value.status === "APPLIED", "RECEIPT_INVALID");
  for (const field of ["planSha256", "baselineSha256", "afterSha256"]) {
    requireValue(typeof value[field] === "string" && SHA.test(value[field]), "RECEIPT_INVALID");
  }
  requireValue(privateAddress(value.hostAddress) && privateAddress(value.guestAddress) && value.hostAddress !== value.guestAddress, "RECEIPT_SCOPE_INVALID");
  const observed = utcTime(value.observedAt), expires = utcTime(value.expiresAt);
  requireValue(observed <= now && now - observed <= 900_000 && expires > now && expires <= now + 86_400_000, "RECEIPT_EXPIRED_OR_STALE");
  return expires;
}

function hostFingerprint(publicKey) {
  requireValue(typeof publicKey === "string" && /^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/.test(publicKey), "HOST_KEY_INVALID");
  const encoded = publicKey.split(" ")[1], bytes = Buffer.from(encoded, "base64");
  requireValue(bytes.length === 51 && bytes.subarray(0, 19).equals(Buffer.from("0000000b7373682d6564323535313900000020", "hex"))
    && bytes.toString("base64") === encoded, "HOST_KEY_INVALID");
  return `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;
}

function newOutput(file) {
  const path = external(file);
  requireValue(lstatSync(dirname(path)).isDirectory(), "OUTPUT_PARENT_INVALID");
  try { lstatSync(path); } catch (error) { if (error.code === "ENOENT") return path; throw error; }
  throw Error("OUTPUT_EXISTS");
}

function writeExclusive(file, bytes) {
  // Never delete on failure: a concurrent owner-created path or a partial write
  // must remain visible for reconciliation, not be silently removed.
  newOutput(file);
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}

function blocked(error, createdOutputs = [], unconfirmedOutput) {
  const code = typeof error?.message === "string" && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message) ? error.message : "INPUT_OR_IO_FAILURE";
  return { ok: false, status: "BLOCKED", code: `AI09_HANDOFF_${code}`, authenticatedConnectionVerified: false,
    createdOutputs, ...(unconfirmedOutput ? { unconfirmedOutput } : {}) };
}

/** Compile owner-pinned configuration receipts, never authentication evidence.
 * All authority paths and ancestors must remain owner-controlled during use.
 * Identity and SSH executable contents are deliberately never opened or run.
 */
export function prepareAi09AccessHandoff(input, { now = Date.now(), writeExclusive: write = writeExclusive } = {}) {
  const createdOutputs = []; let unconfirmedOutput;
  try {
    requireValue(exact(input, requestKeys) && input.version === 1 && Number.isSafeInteger(now), "REQUEST_INVALID");
    // Reject path-role collisions before opening any receipt; client identity
    // contents must not become receipt input even through a mistaken request.
    const paths = [input.hostReceiptPath, input.guestReceiptPath, input.identityFile, input.sshExecutable, input.configOutput, input.knownHostsOutput]
      .map((file) => external(file)).map((file) => process.platform === "win32" ? file.toLowerCase() : file);
    requireValue(new Set(paths).size === paths.length, "PATH_COLLISION");
    const host = readPinned(input.hostReceiptPath, input.hostReceiptSha256, 16_384);
    const guest = readPinned(input.guestReceiptPath, input.guestReceiptSha256, 16_384);
    const hostExpiry = receipt(host, hostKeys, now), guestExpiry = receipt(guest, guestKeys, now);
    requireValue(host.version === 1 && host.issue === 1219 && host.hostName === "HAJI" && host.vmId === VM && host.nicMac === "00155DDC2C00"
      && guest.nicMac === MAC && host.hostAddress === guest.hostAddress && host.guestAddress === guest.guestAddress, "RECEIPT_SCOPE_INVALID");
    requireValue(typeof guest.hostname === "string" && /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(guest.hostname), "RECEIPT_SCOPE_INVALID");
    requireValue(hostFingerprint(guest.publicHostKey) === guest.hostKeyFingerprint, "HOST_KEY_INVALID");
    const identityFile = metadataOnly(input.identityFile), sshExecutable = metadataOnly(input.sshExecutable);
    requireValue(/^(ssh|ssh\.exe)$/i.test(basename(sshExecutable)), "CLIENT_PATH_INVALID");
    const configPath = newOutput(input.configOutput), knownHostsPath = newOutput(input.knownHostsOutput);
    const knownHosts = Buffer.from(`${guest.guestAddress} ${guest.publicHostKey}\n`);
    const config = Buffer.from(JSON.stringify({
      version: 1, host: guest.guestAddress, port: 22, user: "ai09", identityFile,
      knownHostsFile: knownHostsPath, knownHostsSha256: sha(knownHosts), hostKeyFingerprint: guest.hostKeyFingerprint,
      sshExecutable, expectedHostname: guest.hostname, expectedMac: MAC,
    }, null, 2) + "\n");
    for (const [path, bytes] of [[knownHostsPath, knownHosts], [configPath, config]]) {
      unconfirmedOutput = path; write(path, bytes);
      requireValue(sha(readBoundedRuntimeFile(path, 16_384, [workspace])) === sha(bytes), "OUTPUT_WRITE_UNCONFIRMED");
      createdOutputs.push({ path, sha256: sha(bytes) }); unconfirmedOutput = undefined;
    }
    return { ok: true, status: "PREPARED", authenticatedConnectionVerified: false,
      hostReceiptSha256: input.hostReceiptSha256, guestReceiptSha256: input.guestReceiptSha256,
      configPath, configSha256: sha(config), knownHostsPath, knownHostsSha256: sha(knownHosts),
      expiresAt: new Date(Math.min(hostExpiry, guestExpiry)).toISOString(), createdOutputs };
  } catch (error) { return blocked(error, createdOutputs, unconfirmedOutput); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    requireValue(process.argv.length === 4, "PINNED_REQUEST_REQUIRED");
    result = prepareAi09AccessHandoff(readPinned(process.argv[2], process.argv[3], 16_384));
  } catch (error) { result = blocked(error); }
  process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.ok ? 0 : 1;
}
