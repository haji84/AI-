import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { FilePcIdentityStorage, type PcLocalIdentity } from "./pc-local-identity.ts";
import type { JarvisWorkerIdentity } from "./worker-auth.ts";
import type { JarvisNode } from "./types.ts";
import { privatePcOrigin } from "./private-pc-transport.ts";
import { inspectPrivateIngress, tailscaleBackendIsRunning } from "../../scripts/jarvis-remote-access-lib.mjs";

const execute = promisify(execFile);
async function tailscale(args: string[]): Promise<string> {
  const command = process.platform === "win32"
    ? join(process.env.ProgramFiles || "C:\\Program Files", "Tailscale", "tailscale.exe") : "tailscale";
  try {
    const result = await execute(command, args, { encoding: "utf8", timeout: 3000, maxBuffer: 262144, windowsHide: true });
    return result.stdout;
  } catch { throw new Error("PC_PRIVATE_NETWORK_UNAVAILABLE"); }
}
function tailnetDomain(dnsName: string): string {
  const labels = dnsName.replace(/\.$/, "").split(".");
  if (labels.length !== 4) throw new Error("PC_PRIVATE_NETWORK_UNAVAILABLE");
  const domain = labels.slice(1).join(".");
  privatePcOrigin("https://" + labels.join("."), domain);
  return domain;
}
export function privatePcDiscovery(status: { BackendState?: string; Self?: { DNSName?: string };
  Peer?: Record<string, { DNSName?: string; Online?: boolean }> }): { domain: string; origins: string[] } {
  if (!tailscaleBackendIsRunning(status) || !status.Self?.DNSName) throw new Error("PC_PRIVATE_NETWORK_UNAVAILABLE");
  const domain = tailnetDomain(status.Self.DNSName), origins = new Set<string>();
  for (const peer of Object.values(status.Peer || {})) {
    if (peer.Online !== true || !peer.DNSName) continue;
    try { origins.add(privatePcOrigin("https://" + peer.DNSName.replace(/\.$/, ""), domain)); } catch { /* not an eligible private endpoint */ }
  }
  if (origins.size > 32) throw new Error("PC_PRIVATE_NETWORK_UNAVAILABLE");
  return { domain, origins: [...origins].sort() };
}
export async function discoverNativePrivatePcs() {
  return privatePcDiscovery(JSON.parse(await tailscale(["status", "--json"])));
}
export async function privatePcIngressReady(request: Request, input: {
  platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; run?: (args: string[]) => Promise<string>;
} = {}): Promise<boolean> {
  const platform = input.platform ?? process.platform, env = input.env ?? process.env, run = input.run ?? tailscale;
  if (!["win32", "darwin"].includes(platform) || env.VERCEL || env.JARVIS_PRIVATE_WORKER_INGRESS_ENABLED !== "1" ||
    env.JARVIS_BROKER_HOST !== "127.0.0.1" || env.JARVIS_REMOTE_GATEWAY_HOST !== "127.0.0.1" ||
    env.JARVIS_DASHBOARD_PORT !== "3000" || request.headers.has("tailscale-funnel-request") ||
    !request.headers.get("tailscale-user-login") || request.headers.get("x-forwarded-proto") !== "https") return false;
  try {
    const status = JSON.parse(await run(["status", "--json"]));
    if (!tailscaleBackendIsRunning(status) || typeof status.Self?.DNSName !== "string") return false;
    const host = status.Self.DNSName.replace(/\.$/, "");
    const domain = tailnetDomain(host);
    const forwarded = request.headers.get("x-forwarded-host") || "";
    if (forwarded !== host && forwarded !== host + ":443") return false;
    const hostHeader = request.headers.get("host");
    if (hostHeader !== host && hostHeader !== host + ":443") return false;
    // Next may construct its internal URL from the loopback listener. Serve's
    // overwritten Host/forwarded headers remain the private origin boundary.
    if (![host, "127.0.0.1", "localhost"].includes(new URL(request.url).hostname)) return false;
    privatePcOrigin("https://" + host, domain);
    const serve = await run(["serve", "status", "--json"]);
    return inspectPrivateIngress(serve, { dnsName: host, dashboardPort: 3000 }).ready === true;
  } catch { return false; }
}
export function registeredPrivatePcSigner(identity: PcLocalIdentity, node: JarvisNode | undefined,
  registered: JarvisWorkerIdentity | undefined, revision: string) {
  try {
    if (!["macbook", "zbook"].includes(identity.nodeId) || identity.version !== 1 || identity.algorithm !== "ed25519" ||
      node?.id !== identity.nodeId || node.kind !== identity.platform || registered?.nodeId !== identity.nodeId ||
      registered.revokedAt || registered.algorithm !== "ed25519" || node.pcAuthority?.version !== 1 ||
      node.pcAuthority.approvalIssue !== 1662 || node.pcAuthority.goalIssue !== 1219 ||
      !node.pcAuthority.roles.includes("Coordinator") || !/^[a-f0-9]{40}$/.test(revision) ||
      !/^[a-f0-9]{64}$/.test(identity.hostBinding) || !Number.isFinite(Date.parse(identity.createdAt))) throw new Error();
    const privateKey = createPrivateKey(identity.privateKeyPem);
    const publicKey = createPublicKey(identity.publicKeyPem);
    if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519" ||
      createPublicKey(privateKey).export({ type: "spki", format: "pem" }) !== publicKey.export({ type: "spki", format: "pem" }) ||
      publicKey.export({ type: "spki", format: "pem" }) !== createPublicKey(registered.publicKeyPem).export({ type: "spki", format: "pem" })) throw new Error();
    return { identity, revision };
  } catch { throw new Error("PC_PRIVATE_SIGNER_UNAVAILABLE"); }
}
/** A Tailnet address never grants trust: require the already enrolled counterpart. */
export function registeredPrivatePcPeer(ownNodeId: string, node: JarvisNode | undefined,
  registered: JarvisWorkerIdentity | undefined): JarvisWorkerIdentity {
  try {
    const expected = ownNodeId === "zbook" ? "macbook" : ownNodeId === "macbook" ? "zbook" : undefined;
    if (!expected || node?.id !== expected || node.kind !== (expected === "zbook" ? "windows" : "macos") ||
      registered?.nodeId !== expected || registered.revokedAt || registered.algorithm !== "ed25519" ||
      node.pcAuthority?.version !== 1 || node.pcAuthority.approvalIssue !== 1662 || node.pcAuthority.goalIssue !== 1219 ||
      !node.pcAuthority.roles.includes("Coordinator") || createPublicKey(registered.publicKeyPem).asymmetricKeyType !== "ed25519") throw new Error();
    return registered;
  } catch { throw new Error("PC_MOBILE_MUTUAL_ENROLLMENT_REQUIRED"); }
}
export async function nativePrivatePcSigner() {
  try {
    if (!["win32", "darwin"].includes(process.platform) || process.env.VERCEL) throw new Error();
    const nodeId = process.platform === "win32" ? "zbook" : "macbook";
    const root = process.platform === "win32" ? join(process.env.USERPROFILE || homedir(), "JARVIS", "production", "pc-node", nodeId) :
      join(homedir(), ".goriq", "state", "pc-node", nodeId);
    const raw = await new FilePcIdentityStorage(join(root, process.platform === "win32" ? "identity.dpapi" : "identity.json")).read();
    const dbPath = process.env.JARVIS_DB_PATH, revision = process.env.GORIQ_RUNTIME_REVISION || "";
    if (!raw || !dbPath || !isAbsolute(dbPath)) throw new Error();
    const identity = JSON.parse(raw) as PcLocalIdentity;
    if (identity.nodeId !== nodeId || identity.platform !== (process.platform === "win32" ? "windows" : "macos")) throw new Error();
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
    let node: JarvisNode | undefined, registered: JarvisWorkerIdentity | undefined;
    try {
      const state = db.prepare("SELECT payload FROM jarvis_state WHERE id=1").get();
      const entry = db.prepare("SELECT payload FROM jarvis_worker_identity WHERE node_id=?").get(nodeId);
      node = JSON.parse(String(state?.payload)).fleet.find((item: JarvisNode) => item.id === nodeId);
      registered = entry ? JSON.parse(String(entry.payload)) : undefined;
    } finally { db.close(); }
    const signer = registeredPrivatePcSigner(identity, node, registered, revision);
    const response = await fetch("http://127.0.0.1:8787/health", { signal: AbortSignal.timeout(3000), redirect: "error" });
    const health = await response.json();
    if (!response.ok || health.ok !== true || health.runtimeRevision !== revision) throw new Error();
    return signer;
  } catch { throw new Error("PC_PRIVATE_SIGNER_UNAVAILABLE"); }
}
