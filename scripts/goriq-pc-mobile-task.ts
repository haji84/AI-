import { execFileSync } from "node:child_process";
import { createHash, randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { FilePcIdentityStorage, ensurePcLocalIdentity } from "../src/jarvis/pc-local-identity.ts";
import { validatePcEnrollmentApproval } from "../src/jarvis/pc-enrollment.ts";
import { assertPcRuntime, executeRemotePcWork, readCommittedPcWorkInput } from "../src/jarvis/pc-bootstrap.ts";
import { assertPcExecutor } from "../src/jarvis/pc-durable-work.ts";
import { canonicalWorkerRequest } from "../src/jarvis/worker-auth.ts";
import { discoverNativePrivatePcs, registeredPrivatePcPeer, registeredPrivatePcSigner } from "../src/jarvis/private-pc-native.ts";
import { privatePcOrigin, verifyPrivatePcResponse } from "../src/jarvis/private-pc-transport.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";
import type { JarvisWorkerIdentity } from "../src/jarvis/worker-auth.ts";

let stage = "source";
async function main() {
  console.log("PC_MOBILE_STAGE=" + stage);
  const revision = process.env.GORIQ_PC_APPROVED_REVISION || "";
  readCommittedPcWorkInput(revision); // exact clean approved public checkout; no private source output
  const approval = validatePcEnrollmentApproval(JSON.parse(await readFile("docs/authorizations/1662-pc-enrollment.json", "utf8")));
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : undefined;
  if (!platform) throw new Error();
  const nodeId = platform === "windows" ? "zbook" : "macbook";
  if (!approval.targets.some(t => t.nodeId === nodeId && t.platform === platform)) throw new Error();
  if (platform === "windows") {
    const configuration = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned",
      "-File", "scripts/read-jarvis-production-config.ps1", "-Path", join(process.env.USERPROFILE || homedir(), "JARVIS", "production", "config.dpapi")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000, maxBuffer: 131072 }).replace(/^\uFEFF/, ""));
    if (configuration.commit !== revision || typeof configuration.environment?.JARVIS_DB_PATH !== "string") throw new Error();
    process.env.JARVIS_DB_PATH = configuration.environment.JARVIS_DB_PATH;
  }
  const dbPath = process.env.JARVIS_DB_PATH;
  if (!dbPath || !isAbsolute(dbPath)) throw new Error();
  await assertPcRuntime("http://127.0.0.1:8787", revision);
  const snapshot = () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT payload FROM jarvis_state WHERE id=1").get() as { payload: string } | undefined;
      if (!row) throw new Error();
      return { state: JSON.parse(row.payload), identities: db.prepare("SELECT node_id,payload FROM jarvis_worker_identity ORDER BY node_id").all() as Array<{ node_id: string; payload: string }> };
    } finally { db.close(); }
  };
  stage = "mutual-enrollment"; console.log("PC_MOBILE_STAGE=" + stage);
  const before = snapshot(), otherId = nodeId === "zbook" ? "macbook" : "zbook";
  const registered = (id: string) => {
    const row = before.identities.find(n => n.node_id === id);
    return row ? JSON.parse(row.payload) as JarvisWorkerIdentity : undefined;
  };
  const peer = registeredPrivatePcPeer(nodeId, before.state.fleet.find((n: JarvisNode) => n.id === otherId), registered(otherId));
  const ownNode = before.state.fleet.find((n: JarvisNode) => n.id === nodeId);
  assertPcExecutor(ownNode, approval.goalIssue);
  if (before.state.fleet.filter((n: JarvisNode) => n.kind === "android").length !== 38) throw new Error();
  stage = "identity"; console.log("PC_MOBILE_STAGE=" + stage);
  const root = platform === "windows" ? join(process.env.USERPROFILE || homedir(), "JARVIS", "production", "pc-node", nodeId) :
    join(homedir(), ".goriq", "state", "pc-node", nodeId);
  const raw = await new FilePcIdentityStorage(join(root, platform === "windows" ? "identity.dpapi" : "identity.json")).read();
  if (!raw) throw new Error();
  const hardware = platform === "macos" ? execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 }).match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]{36})"/)?.[1] :
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Write((Get-CimInstance Win32_ComputerSystemProduct).UUID)"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 }).trim();
  if (!hardware || !/^[A-Fa-f0-9-]{36}$/.test(hardware) || /^0+-0+-0+-0+-0+$/.test(hardware)) throw new Error();
  const identity = await ensurePcLocalIdentity({ nodeId, platform, approval, hostBinding: createHash("sha256").update(hardware.toLowerCase()).digest("hex"),
    storage: { read: async () => raw, writeExclusive: async () => { throw new Error("PC_MOBILE_KEY_CREATION_PROHIBITED"); } } });
  registeredPrivatePcSigner(identity, ownNode, registered(nodeId), revision);
  stage = "discovery"; console.log("PC_MOBILE_STAGE=" + stage);
  const discovered = await discoverNativePrivatePcs();
  const explicit = process.env.GORIQ_PC_PEER_ORIGIN;
  const candidates = explicit ? [privatePcOrigin(explicit, discovered.domain)] : discovered.origins;
  const deadline = AbortSignal.timeout(25_000);
  const path = "/api/jarvis/worker/heartbeat", body = JSON.stringify({ status: "ready", capabilities: ["filesystem"] });
  const probe = async (base: string) => {
    const unsigned = { nodeId, method: "POST", path, timestamp: new Date().toISOString(), nonce: randomUUID(),
      bodySha256: createHash("sha256").update(body).digest("hex") };
    const request = new Request(base + path, { method: "POST", body, redirect: "error",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(3000)]), headers: { "Content-Type": "application/json",
        "X-Jarvis-Node-Id": nodeId, "X-Jarvis-Timestamp": unsigned.timestamp, "X-Jarvis-Nonce": unsigned.nonce,
        "X-Jarvis-Body-Sha256": unsigned.bodySha256, "X-Jarvis-Signature": sign(null, Buffer.from(canonicalWorkerRequest(unsigned)), identity.privateKeyPem).toString("base64") } });
    const response = await verifyPrivatePcResponse(await fetch(request), { request, peer, revision });
    const result = await response.json();
    if (!response.ok || result.node?.id !== nodeId || result.node.kind !== platform) throw new Error();
    return base;
  };
  let selected: string | undefined;
  for (let offset = 0; offset < candidates.length && !selected && !deadline.aborted; offset += 4) {
    const results = await Promise.allSettled(candidates.slice(offset, offset + 4).map(probe));
    selected = results.find((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")?.value;
  }
  if (!selected) throw new Error("PC_MOBILE_PEER_UNAVAILABLE");
  stage = "execute"; console.log("PC_MOBILE_STAGE=" + stage);
  const taskId = process.env.GORIQ_PC_TASK_ID;
  if (taskId && !/^pc-[a-f0-9]{64}$/.test(taskId)) throw new Error();
  // Discovery only heartbeats. Once any task is claimed, do not try another
  // coordinator on failure; retain the existing durable claim/lease for recovery.
  const execution = await executeRemotePcWork({ base: selected, tailnetDomain: discovered.domain, revision, identity, peer, taskId });
  const after = snapshot();
  if (!isDeepStrictEqual(before.identities, after.identities) || !isDeepStrictEqual(
    before.state.fleet.filter((n: JarvisNode) => n.kind === "android"), after.state.fleet.filter((n: JarvisNode) => n.kind === "android"))) throw new Error();
  const receipt = { version: 1, issue: 1662, goalIssue: 1219, ...execution, peerNodeId: peer.nodeId, peerSignatureVerified: true,
    transport: "existing-private-https", androidCount: 38, identitiesPreserved: true, androidRecordsPreserved: true,
    evidenceClass: "MACHINE_VERIFIED", observedAt: new Date().toISOString() };
  await new FilePcIdentityStorage(join(root, "mobile-evidence-" + revision + "-" + randomUUID() + "." + (platform === "windows" ? "dpapi" : "json")))
    .writeExclusive(JSON.stringify(receipt));
  stage = "complete"; console.log("PC_MOBILE_STAGE=" + stage); console.log(JSON.stringify(receipt));
}
main().catch(error => {
  const reason = error instanceof Error && ["PC_MOBILE_MUTUAL_ENROLLMENT_REQUIRED", "PC_MOBILE_PEER_UNAVAILABLE"].includes(error.message)
    ? error.message : "PC_MOBILE_EXECUTION_REJECTED";
  console.error(JSON.stringify({ version: 1, issue: 1662, failedStage: stage, failureReason: reason,
    complete: false, retainedExistingKeysAndState: true })); process.exitCode = 1;
});
