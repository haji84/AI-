import { execFileSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { validatePcEnrollmentApproval } from "../src/jarvis/pc-enrollment.ts";
import { ensurePcLocalIdentity, FilePcIdentityStorage } from "../src/jarvis/pc-local-identity.ts";
import { assertPcRuntime, registerLocalPc } from "../src/jarvis/pc-bootstrap.ts";

async function main() {
  const revision = process.env.GORIQ_PC_APPROVED_REVISION ?? "";
  if (!/^[a-f0-9]{40}$/.test(revision) || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== revision) throw new Error("PC_SOURCE_MISMATCH");
  const approval = validatePcEnrollmentApproval(JSON.parse(await readFile("docs/authorizations/1662-pc-enrollment.json", "utf8")));
  const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : undefined;
  if (!platform) throw new Error("PC_PLATFORM_REJECTED");
  const nodeId = platform === "macos" ? "macbook" : "zbook";
  let configuredRevision: string | undefined;
  if (!approval.targets.some(t => t.nodeId === nodeId && t.platform === platform)) throw new Error("PC_SCOPE_REJECTED");
  if (platform === "windows") {
    // Capture locally decrypted existing configuration; never publish it or change it.
    const configPath = join(process.env.USERPROFILE ?? homedir(), "JARVIS", "production", "config.dpapi");
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-File", "scripts/read-jarvis-production-config.ps1", "-Path", configPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 131072, timeout: 15000 });
    const configuration = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (/^[a-f0-9]{40}$/.test(configuration.commit ?? "")) configuredRevision = configuration.commit;
    for (const name of ["JARVIS_OWNER_TOKEN", "JARVIS_DB_PATH"]) {
      const value = configuration.environment?.[name];
      if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) throw new Error("PC_OWNER_CONFIGURATION_UNAVAILABLE");
      process.env[name] = value;
    }
  }
  const base = "http://127.0.0.1:8787";
  if (process.env.GORIQ_PC_PHASE === "preflight") {
    const health = await (await fetch(base + "/health", { signal: AbortSignal.timeout(5000) })).json();
    const dbPath = process.env.JARVIS_DB_PATH;
    if (!dbPath) throw new Error("PC_FLEET_UNAVAILABLE");
    const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
    let durableNonceTablePresent = false;
    try { durableNonceTablePresent = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jarvis_worker_nonce'").get()); }
    finally { db.close(); }
    console.log(JSON.stringify({ version: 1, nodeId, expectedRevision: revision,
      configuredRevision: configuredRevision ?? null,
      observedRuntimeRevision: /^[a-f0-9]{40}$/.test(health.runtimeRevision ?? "") ? health.runtimeRevision : null,
      brokerHealthy: health.ok === true, durableNonceTablePresent, readOnly: true, observedAt: new Date().toISOString() }));
  }
  await assertPcRuntime(base, revision);
  if (process.env.GORIQ_PC_PHASE === "preflight") {
    console.log(JSON.stringify({ version: 1, nodeId, sourceRevision: revision, runtimeExact: true, observedAt: new Date().toISOString() })); return;
  }
  if (process.env.GORIQ_PC_PHASE !== "enroll") throw new Error("PC_PHASE_REJECTED");
  const dbPath = process.env.JARVIS_DB_PATH;
  if (!dbPath || !process.env.JARVIS_OWNER_TOKEN) throw new Error("PC_OWNER_CONFIGURATION_UNAVAILABLE");
  const root = platform === "macos" ? join(homedir(), ".goriq", "state", "pc-node", nodeId) : join(process.env.USERPROFILE ?? homedir(), "JARVIS", "production", "pc-node", nodeId);
  const identityPath = join(root, platform === "windows" ? "identity.dpapi" : "identity.json");
  const snapshot = () => {
    const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
    try {
      const row = db.prepare("SELECT payload FROM jarvis_state WHERE id=1").get() as { payload: string } | undefined;
      if (!row) throw new Error("PC_FLEET_UNAVAILABLE");
      const state = JSON.parse(row.payload);
      const identities = db.prepare("SELECT node_id,payload FROM jarvis_worker_identity ORDER BY node_id").all() as Array<{ node_id: string; payload: string }>;
      return { state, identities };
    } finally { db.close(); }
  };
  const before = snapshot();
  if (before.state.fleet.filter((n: { kind: string }) => n.kind === "android").length !== 38) throw new Error("PC_FLEET_BASELINE_MISMATCH");
  // Host-local protected recovery evidence, never a DB copy/import or Actions artifact.
  await new FilePcIdentityStorage(join(root, `baseline-${Date.now()}.${platform === "windows" ? "dpapi" : "json"}`)).writeExclusive(JSON.stringify(before));
  const hardware = platform === "macos" ? execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 }).match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]{36})"/)?.[1] :
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Write((Get-CimInstance Win32_ComputerSystemProduct).UUID)"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 }).trim();
  if (!hardware || !/^[A-Fa-f0-9-]{36}$/.test(hardware) || /^0+-0+-0+-0+-0+$/.test(hardware)) throw new Error("PC_HOST_BINDING_UNAVAILABLE");
  const identity = await ensurePcLocalIdentity({ nodeId, platform, hostBinding: createHash("sha256").update(hardware.toLowerCase()).digest("hex"), approval, storage: new FilePcIdentityStorage(identityPath) });
  const existing = before.identities.find(n => n.node_id === nodeId), node = before.state.fleet.find((n: { id: string }) => n.id === nodeId);
  if (existing || node) {
    const saved = existing && JSON.parse(existing.payload);
    if (!saved || saved.revokedAt || !node || node.kind !== platform || node.pcAuthority?.approvalIssue !== approval.issue ||
      node.pcAuthority?.goalIssue !== approval.goalIssue || !isDeepStrictEqual(node.pcAuthority?.roles, approval.roles) ||
      createPublicKey(saved.publicKeyPem).export({ type: "spki", format: "pem" }).toString() !== identity.publicKeyPem) throw new Error("PC_EXISTING_ENROLLMENT_CONFLICT");
  }
  const approvalPath = resolve(dbPath) + ".pc-enrollment-approval.json";
  try {
    const metadata = await lstat(approvalPath), parent = await lstat(dirname(approvalPath));
    if (!metadata.isFile() || metadata.isSymbolicLink() || !parent.isDirectory() || parent.isSymbolicLink() ||
      (platform === "macos" && ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid?.())) ||
      !isDeepStrictEqual(JSON.parse(await readFile(approvalPath, "utf8")), approval)) throw new Error("PC_LOCAL_APPROVAL_CONFLICT");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(approvalPath, JSON.stringify(approval), { flag: "wx", mode: 0o600 });
  }
  await registerLocalPc({ base, revision, ownerToken: process.env.JARVIS_OWNER_TOKEN!, identity, alreadyEnrolled: Boolean(existing) });
  const after = snapshot();
  for (const old of before.identities) if (!isDeepStrictEqual(after.identities.find(n => n.node_id === old.node_id), old)) throw new Error("PC_ANDROID_IDENTITY_CHANGED");
  for (const old of before.state.fleet.filter((n: { kind: string }) => n.kind === "android")) {
    if (!isDeepStrictEqual(after.state.fleet.find((n: { id: string }) => n.id === old.id), old)) throw new Error("PC_ANDROID_RECORD_CHANGED");
  }
  const publicEvidence = { version: 1, nodeId, platform, sourceRevision: revision, fingerprint: identity.fingerprint, created: identity.created,
    signedHeartbeat: true, androidRecordsPreserved: true, androidCount: 38, roles: approval.roles, observedAt: new Date().toISOString() };
  console.log(JSON.stringify(publicEvidence));
}
main().catch(() => { console.error("GORIQ_PC_ENROLL_FAILED: source/runtime/scope/storage/enrollment validation failed; retained existing data and keys"); process.exitCode = 1; });
