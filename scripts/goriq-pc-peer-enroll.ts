import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { validatePcEnrollmentApproval } from "../src/jarvis/pc-enrollment.ts";
import { ensurePcLocalIdentity, FilePcIdentityStorage } from "../src/jarvis/pc-local-identity.ts";
import { assertPcRuntime, readCommittedPcWorkInput } from "../src/jarvis/pc-bootstrap.ts";
import { registeredPrivatePcSigner } from "../src/jarvis/private-pc-native.ts";
import { assertExistingPcPeer, publicPcDescriptor, validatePublicPcDescriptor,
  requestPeerPcEnrollment, signPeerPcEnrollment, completePeerPcEnrollment } from "../src/jarvis/pc-peer-bootstrap.ts";
import type { PublicPcDescriptor, PeerPcEnvelope, PeerPcProof } from "../src/jarvis/pc-peer-bootstrap.ts";
import type { JarvisNode } from "../src/jarvis/types.ts";
import type { JarvisWorkerIdentity } from "../src/jarvis/worker-auth.ts";
let stage = "source";
const incoming = (name: string) => {
  const text = process.env[name] || "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length > 24576) throw new Error("PC_PEER_PUBLIC_INPUT_REJECTED");
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text || bytes.length > 16384) throw new Error("PC_PEER_PUBLIC_INPUT_REJECTED");
  return JSON.parse(bytes.toString("utf8"));
};
async function main() {
  console.log("PC_PEER_STAGE=" + stage);
  const revision = process.env.GORIQ_PC_APPROVED_REVISION || "", phase = process.env.GORIQ_PC_PEER_PHASE || "";
  if (!["export","challenge","sign-and-challenge","complete-and-sign","complete"].includes(phase)) throw new Error();
  readCommittedPcWorkInput(revision);
  execFileSync(process.execPath, ["scripts/goriq-pc-approved-source.mjs"], { stdio: ["ignore","ignore","pipe"], timeout: 30000 });
  const approval = validatePcEnrollmentApproval(JSON.parse(await readFile("docs/authorizations/1662-pc-enrollment.json", "utf8")));
  if (approval.issue !== 1662 || approval.goalIssue !== 1219 || approval.targets.length !== 2 || approval.roles.length !== 4 ||
    new Set(approval.roles).size !== 4 || !["Executor","Storage","Verifier","Coordinator"].every(r => approval.roles.includes(r as "Executor"))) throw new Error();
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : undefined;
  if (!platform) throw new Error();
  const nodeId = platform === "windows" ? "zbook" : "macbook", otherId = nodeId === "zbook" ? "macbook" : "zbook";
  if (!approval.targets.some(t => t.nodeId === nodeId && t.platform === platform) ||
    !approval.targets.some(t => t.nodeId === otherId && t.platform === (otherId === "macbook" ? "macos" : "windows"))) throw new Error();
  if (platform === "windows") {
    const configuration = JSON.parse(execFileSync("powershell.exe", ["-NoProfile","-NonInteractive","-ExecutionPolicy","RemoteSigned",
      "-File","scripts/read-jarvis-production-config.ps1","-Path",join(process.env.USERPROFILE || homedir(),"JARVIS","production","config.dpapi")],
      { encoding: "utf8", stdio: ["ignore","pipe","pipe"], timeout: 15000, maxBuffer: 131072 }).replace(/^\uFEFF/,""));
    if (configuration.commit !== revision) throw new Error();
    for (const key of ["JARVIS_DB_PATH","JARVIS_OWNER_TOKEN"]) {
      const value = configuration.environment?.[key];
      if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) throw new Error();
      process.env[key] = value;
    }
  }
  const dbPath = process.env.JARVIS_DB_PATH, ownerToken = process.env.JARVIS_OWNER_TOKEN, base = "http://127.0.0.1:8787";
  if (!dbPath || !isAbsolute(dbPath) || !ownerToken) throw new Error();
  const localApproval = JSON.parse(await readFile(dbPath + ".pc-enrollment-approval.json","utf8"));
  if (!isDeepStrictEqual(validatePcEnrollmentApproval(localApproval), approval)) throw new Error("PC_PEER_LOCAL_APPROVAL_MISMATCH");
  await assertPcRuntime(base, revision);
  const snapshot = () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      db.exec("BEGIN");
      const stateRow = db.prepare("SELECT payload FROM jarvis_state WHERE id=1").get() as { payload: string } | undefined;
      if (!stateRow) throw new Error();
      const state = JSON.parse(stateRow.payload) as { fleet: JarvisNode[] };
      const identities = db.prepare("SELECT node_id,payload FROM jarvis_worker_identity ORDER BY node_id").all() as Array<{ node_id: string; payload: string }>;
      const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
      return { state, identities, schema };
    } finally { db.close(); }
  };
  const before = snapshot();
  if (before.state.fleet.filter(n => n.kind === "android").length !== 38 ||
    before.state.fleet.some(n => ["windows","macos"].includes(n.kind) && !["macbook","zbook"].includes(n.id))) throw new Error();
  const savedIdentity = (id: string, data = before): JarvisWorkerIdentity | undefined => {
    const row = data.identities.find(n => n.node_id === id); return row ? JSON.parse(row.payload) : undefined;
  };
  stage = "existing-identity"; console.log("PC_PEER_STAGE=" + stage);
  const root = platform === "windows" ? join(process.env.USERPROFILE || homedir(),"JARVIS","production","pc-node",nodeId) :
    join(homedir(),".goriq","state","pc-node",nodeId);
  const raw = await new FilePcIdentityStorage(join(root,platform === "windows" ? "identity.dpapi" : "identity.json")).read();
  if (!raw) throw new Error("PC_PEER_EXISTING_IDENTITY_REQUIRED");
  const hardware = platform === "macos" ? execFileSync("ioreg",["-rd1","-c","IOPlatformExpertDevice"], {
    encoding: "utf8", stdio: ["ignore","pipe","pipe"], timeout: 10000 }).match(/"IOPlatformUUID"\s*=\s*"([A-Fa-f0-9-]{36})"/)?.[1] :
    execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command","[Console]::Write((Get-CimInstance Win32_ComputerSystemProduct).UUID)"],
      { encoding: "utf8", stdio: ["ignore","pipe","pipe"], timeout: 15000 }).trim();
  if (!hardware || !/^[A-Fa-f0-9-]{36}$/.test(hardware) || /^0+-0+-0+-0+-0+$/.test(hardware)) throw new Error();
  const identity = await ensurePcLocalIdentity({ nodeId, platform, approval,
    hostBinding: createHash("sha256").update(hardware.toLowerCase()).digest("hex"),
    storage: { read: async () => raw, writeExclusive: async () => { throw new Error("PC_PEER_KEY_CREATION_PROHIBITED"); } } });
  registeredPrivatePcSigner(identity, before.state.fleet.find(n => n.id === nodeId), savedIdentity(nodeId), revision);
  const descriptor = publicPcDescriptor(identity, revision), output: Record<string,string> = {
    descriptor: Buffer.from(JSON.stringify(descriptor)).toString("base64"), fingerprint: descriptor.fingerprint };
  let peer: PublicPcDescriptor | undefined, completed: { nodeId: string; fingerprint: string; alreadyEnrolled: boolean } | undefined;
  if (phase !== "export") {
    peer = validatePublicPcDescriptor(incoming("GORIQ_PC_PEER_DESCRIPTOR"), {
      nodeId: otherId, revision, fingerprint: process.env.GORIQ_PC_PEER_FINGERPRINT || "" });
    const existingNode = before.state.fleet.find(n => n.id === otherId), existingIdentity = savedIdentity(otherId);
    if (existingNode || existingIdentity) assertExistingPcPeer(peer, existingNode, existingIdentity);
    // Recovery baseline stays protected on this host, never in job outputs/artifacts.
    await new FilePcIdentityStorage(join(root,"peer-baseline-" + revision + "-" + randomUUID() + "." + (platform === "windows" ? "dpapi" : "json")))
      .writeExclusive(JSON.stringify(before));
    stage = "public-proof"; console.log("PC_PEER_STAGE=" + stage);
    if (phase === "complete-and-sign" || phase === "complete") {
      completed = await completePeerPcEnrollment({ base, revision, ownerToken, identity, peer,
        expectedPeerFingerprint: peer.fingerprint, envelope: incoming("GORIQ_PC_OWN_ENVELOPE") as PeerPcEnvelope,
        proof: incoming("GORIQ_PC_PEER_PROOF") as PeerPcProof });
    }
    if (phase === "sign-and-challenge" || phase === "complete-and-sign") {
      const proof = signPeerPcEnrollment({ envelope: incoming("GORIQ_PC_SIGN_ENVELOPE"), identity, revision,
        expectedCoordinatorFingerprint: peer.fingerprint });
      output.proof = Buffer.from(JSON.stringify(proof)).toString("base64");
    }
    if (phase === "challenge" || phase === "sign-and-challenge") {
      const envelope = await requestPeerPcEnrollment({ base, revision, ownerToken, identity, peer,
        expectedPeerFingerprint: peer.fingerprint, existing: existingNode && existingIdentity ? { node: existingNode, identity: existingIdentity } : undefined });
      output.envelope = Buffer.from(JSON.stringify(envelope)).toString("base64");
    }
  }
  stage = "verify"; console.log("PC_PEER_STAGE=" + stage);
  const after = snapshot();
  if (!isDeepStrictEqual(before.schema,after.schema) ||
    !isDeepStrictEqual(before.state.fleet.filter(n => n.kind === "android"),after.state.fleet.filter(n => n.kind === "android")) ||
    before.identities.some(old => !isDeepStrictEqual(after.identities.find(n => n.node_id === old.node_id),old)) ||
    before.state.fleet.filter(n => n.id !== otherId).some(old => !isDeepStrictEqual(after.state.fleet.find(n => n.id === old.id),old))) throw new Error("PC_PEER_PRESERVATION_REJECTED");
  if (completed && peer) {
    assertExistingPcPeer(peer,after.state.fleet.find(n => n.id === otherId),savedIdentity(otherId,after));
    if (after.state.fleet.length !== 40 || after.identities.length !== 40 ||
      after.state.fleet.filter(n => ["macbook","zbook"].includes(n.id)).length !== 2) throw new Error("PC_PEER_FLEET_COUNT_REJECTED");
  } else if (!isDeepStrictEqual(before.identities,after.identities)) throw new Error();
  const receipt = { version: 1, issue: 1662, goalIssue: 1219, nodeId, phase, sourceRevision: revision,
    fingerprint: descriptor.fingerprint, peerNodeId: peer?.nodeId, peerFingerprint: peer?.fingerprint,
    mutualSideEnrolled: Boolean(completed), androidCount: 38, identityCount: after.identities.length,
    existingIdentitiesPreserved: true, androidRecordsPreserved: true, schemaPreserved: true,
    keyCreation: false, observedAt: new Date().toISOString(), evidenceClass: "MACHINE_VERIFIED" };
  if (phase !== "export") await new FilePcIdentityStorage(join(root,"peer-evidence-" + revision + "-" + randomUUID() + "." + (platform === "windows" ? "dpapi" : "json")))
    .writeExclusive(JSON.stringify(receipt));
  // Strict public allowlist only. No native configuration, baseline or private key.
  if (process.env.GITHUB_OUTPUT) for (const [name,value] of Object.entries(output)) {
    if (!["descriptor","fingerprint","envelope","proof"].includes(name) || /[\r\n\0]/.test(value)) throw new Error();
    await appendFile(process.env.GITHUB_OUTPUT,name + "=" + value + "\n");
  }
  stage = "complete"; console.log("PC_PEER_STAGE=" + stage); console.log(JSON.stringify(receipt));
}
main().catch(error => {
  const known = ["PC_PEER_LOCAL_APPROVAL_MISMATCH","PC_PEER_EXISTING_IDENTITY_REQUIRED","PC_PEER_EXISTING_CONFLICT","PC_PEER_DESCRIPTOR_REJECTED","PC_PEER_CHALLENGE_REJECTED","PC_PEER_PROOF_REJECTED"];
  console.error(JSON.stringify({ version: 1, issue: 1662, failedStage: stage,
    failureReason: error instanceof Error && known.includes(error.message) ? error.message : "PC_PEER_ENROLLMENT_REJECTED",
    complete: false, retainedExistingKeysAndState: true })); process.exitCode = 1;
});
