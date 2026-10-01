import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { readFile, lstat, mkdir, open, link, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { validatePcEnrollmentApproval, type PcEnrollmentApproval } from "./pc-enrollment.ts";

export interface PcIdentityStorage { read(): Promise<string | undefined>; writeExclusive(value: string): Promise<void>; }
export interface PcLocalIdentity {
  version: 1; nodeId: string; platform: "macos" | "windows" | "linux";
  hostBinding: string; algorithm: "ed25519"; publicKeyPem: string; privateKeyPem: string; createdAt: string;
}

export async function ensurePcLocalIdentity(input: { nodeId: string; platform: PcLocalIdentity["platform"];
  hostBinding: string; approval: PcEnrollmentApproval; storage: PcIdentityStorage; now?: Date }): Promise<PcLocalIdentity & { fingerprint: string; created: boolean }> {
  const now = input.now ?? new Date(), approval = validatePcEnrollmentApproval(input.approval, now);
  if (!approval.targets.some(t => t.nodeId === input.nodeId && t.platform === input.platform) || !input.hostBinding.trim()) throw new Error("PC_IDENTITY_APPROVAL_REQUIRED");
  const existing = await input.storage.read();
  let identity: PcLocalIdentity;
  if (existing !== undefined) {
    try {
      identity = JSON.parse(existing) as PcLocalIdentity;
      if (identity.version !== 1 || identity.nodeId !== input.nodeId || identity.platform !== input.platform ||
        identity.hostBinding !== input.hostBinding || identity.algorithm !== "ed25519" ||
        typeof identity.createdAt !== "string" || !Number.isFinite(Date.parse(identity.createdAt))) throw new Error();
      const privateKey = createPrivateKey(identity.privateKeyPem), publicKey = createPublicKey(identity.publicKeyPem);
      const proof = Buffer.from(randomUUID());
      if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519" ||
        !verify(null, proof, publicKey, sign(null, proof, privateKey))) throw new Error();
    } catch { throw new Error("PC_LOCAL_IDENTITY_CONFLICT"); }
  } else {
    const keys = generateKeyPairSync("ed25519");
    identity = { version: 1, nodeId: input.nodeId, platform: input.platform, hostBinding: input.hostBinding,
      algorithm: "ed25519", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      privateKeyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), createdAt: now.toISOString() };
    await input.storage.writeExclusive(JSON.stringify(identity));
  }
  const fingerprint = createHash("sha256").update(createPublicKey(identity.publicKeyPem).export({ type: "spki", format: "der" })).digest("hex");
  return { ...identity, fingerprint, created: existing === undefined };
}

/** Uses the current Windows user's existing DPAPI boundary. No secrets in arguments/logs. */
export function pcDpapi(operation: "protect" | "unprotect", input: Buffer): Promise<Buffer> {
  if (process.platform !== "win32") return Promise.reject(new Error("PC_DPAPI_UNAVAILABLE"));
  const method = operation === "protect" ? "Protect" : "Unprotect";
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $raw=[Console]::In.ReadToEnd(); $bytes=[Convert]::FromBase64String($raw); $result=[System.Security.Cryptography.ProtectedData]::${method}($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", finished = false;
    const fail = () => { if (!finished) { finished = true; reject(new Error("PC_DPAPI_UNAVAILABLE")); } };
    const timer = setTimeout(() => { child.kill(); fail(); }, 15_000);
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.resume(); child.on("error", fail); child.stdin.on("error", fail);
    child.on("close", code => { clearTimeout(timer); if (code !== 0) { fail(); return; }
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(output.trim())) { fail(); return; }
      if (!finished) { finished = true; resolve(Buffer.from(output.trim(), "base64")); } });
    child.stdin.end(input.toString("base64"));
  });
}

export class FilePcIdentityStorage implements PcIdentityStorage {
  private readonly path: string;
  constructor(path: string) { this.path = path; }
  private async validate(path: string, directory = false): Promise<void> {
    const stat = await lstat(path);
    if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink() ||
      (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw new Error("PC_IDENTITY_STORAGE_REJECTED");
  }
  async read(): Promise<string | undefined> {
    try {
      await this.validate(dirname(this.path), true); await this.validate(this.path);
      const bytes = await readFile(this.path);
      if (bytes.length > 16384) throw new Error("PC_IDENTITY_STORAGE_REJECTED");
      return (process.platform === "win32" ? await pcDpapi("unprotect", bytes) : bytes).toString("utf8");
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  async writeExclusive(value: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 }); await this.validate(dirname(this.path), true);
    const bytes = process.platform === "win32" ? await pcDpapi("protect", Buffer.from(value)) : Buffer.from(value);
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await link(temporary, this.path);
    } finally { await unlink(temporary); }
  }
}
