import { execFileSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { FilePcIdentityStorage, ensurePcLocalIdentity } from "../src/jarvis/pc-local-identity.ts";
import { validatePcEnrollmentApproval } from "../src/jarvis/pc-enrollment.ts";
import { assertPcRuntime, executeLocalPcWork } from "../src/jarvis/pc-bootstrap.ts";
import { assertPcExecutor, pcDigest } from "../src/jarvis/pc-durable-work.ts";

let stage = "source";
async function main() {
  console.log("PC_TASK_STAGE=" + stage);
  const revision = process.env.GORIQ_PC_APPROVED_REVISION ?? "";
  if (!/^[a-f0-9]{40}$/.test(revision) ||
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim() !== revision) throw new Error();
  const approval = validatePcEnrollmentApproval(JSON.parse(await readFile("docs/authorizations/1662-pc-enrollment.json", "utf8")));
  const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : undefined;
  if (!platform) throw new Error();
  const nodeId = platform === "windows" ? "zbook" : "macbook";
  if (!approval.targets.some(t => t.nodeId === nodeId && t.platform === platform) || !approval.roles.includes("Executor")) throw new Error();
  if (platform === "windows") {
    const path = join(process.env.USERPROFILE ?? homedir(), "JARVIS", "production", "config.dpapi");
    const configuration = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned",
      "-File", "scripts/read-jarvis-production-config.ps1", "-Path", path], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000, maxBuffer: 131072 }).replace(/^\uFEFF/, ""));
    if (configuration.commit !== revision) throw new Error();
    for (const name of ["JARVIS_OWNER_TOKEN", "JARVIS_DB_PATH"]) {
      const value = configuration.environment?.[name];
      if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) throw new Error();
      process.env[name] = value;
    }
  }
  const dbPath = process.env.JARVIS_DB_PATH, ownerToken = process.env.JARVIS_OWNER_TOKEN, base = "http://127.0.0.1:8787";
  if (!dbPath || !ownerToken) throw new Error();
  await assertPcRuntime(base, revision);
  stage = "identity"; console.log("PC_TASK_STAGE=" + stage);
  const root = platform === "windows" ? join(process.env.USERPROFILE ?? homedir(), "JARVIS", "production", "pc-node", nodeId) :
    join(homedir(), ".goriq", "state", "pc-node", nodeId);
  const raw = await new FilePcIdentityStorage(join(root, platform === "windows" ? "identity.dpapi" : "identity.json")).read();
  if (!raw) throw new Error();
  const hardware = platform === "macos" ? execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 }).match(/"IOPlatformUUID"\\s*=\\s*"([A-Fa-f0-9-]{36})"/)?.[1] :
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::Write((Get-CimInstance Win32_ComputerSystemProduct).UUID)"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 }).trim();
  if (!hardware || !/^[A-Fa-f0-9-]{36}$/.test(hardware) || /^0+-0+-0+-0+-0+$/.test(hardware)) throw new Error("PC_TASK_HOST_BINDING_UNAVAILABLE");
  const identity = await ensurePcLocalIdentity({ nodeId, platform, approval,
    hostBinding: createHash("sha256").update(hardware.toLowerCase()).digest("hex"),
    storage: { read: async () => raw, writeExclusive: async () => { throw new Error("PC_TASK_KEY_CREATION_PROHIBITED"); } } });
  const snapshot = () => {
    const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
    try {
      const row = db.prepare("SELECT payload FROM jarvis_state WHERE id=1").get() as { payload: string } | undefined;
      if (!row) throw new Error();
      return { state: JSON.parse(row.payload),
        identities: db.prepare("SELECT node_id,payload FROM jarvis_worker_identity ORDER BY node_id").all() };
    } finally { db.close(); }
  };
  const before = snapshot(), node = before.state.fleet.find((n: { id: string }) => n.id === nodeId);
  assertPcExecutor(node, approval.goalIssue);
  const registered = before.identities.find((n: { node_id: string }) => n.node_id === nodeId);
  if (!registered || JSON.parse(String(registered.payload)).revokedAt ||
    createPublicKey(JSON.parse(String(registered.payload)).publicKeyPem).export({ type: "spki", format: "pem" }).toString() !== identity.publicKeyPem ||
    before.state.fleet.filter((n: { kind: string }) => n.kind === "android").length !== 38) throw new Error();
  const content = (await readFile("docs/architecture/goriq-distributed-node-fabric.md", "utf8")).replace(/\r\n/g, "\n");
  const expected = pcDigest(content);
  const work = { idempotencyKey: `1662:${revision}:${nodeId}:public-spec-sha256-v1`, goalIssue: approval.goalIssue,
    targetNodeId: nodeId, privacyClass: "PUBLIC", content, capsule: {
      goal: "#1219", currentJob: "#1662 registered PC public specification digest",
      why: "Process immutable public GORIQ specification as registered filesystem Executor",
      workflowPosition: "enrollment -> assignment -> file execution -> signed result",
      inputs: [`sourceRevision=${revision}`, "public docs/architecture/goriq-distributed-node-fabric.md", `sha256=${expected.sha256}`],
      constraints: ["filesystem capability only", "no arbitrary paths or commands", "preserve Android38 identities", "no private data egress"],
      decisions: ["RESTARTABLE digest using existing durable execution claim"], dependencies: ["registered host-local signing key", "exact main CI and runtime"],
      expectedOutput: ["file-backed SHA256", "UTF8 byte count", "signed result provenance"],
      definitionOfDone: ["Broker verifies digest and active claim", "original Android fleet and identities preserved"],
      verificationContract: "Broker independently recomputes digest and rejects stale epoch; caller checks expected public-source digest",
      recoveryContext: ["retain durable work on failure", "reuse task idempotency key and existing identity", "no reenrollment or key replacement"] } };
  stage = "dispatch"; console.log("PC_TASK_STAGE=" + stage);
  const response = await fetch(base + "/api/jarvis/admin/pc-tasks", { method: "POST", redirect: "error",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify(work), signal: AbortSignal.timeout(5000) });
  if (response.status !== 201) throw new Error();
  const task = (await response.json()).task;
  let execution;
  if (task?.status === "completed") {
    if (task.result?.verified !== true || task.result.nodeId !== nodeId || task.result.sha256 !== expected.sha256 ||
      task.result.bytes !== expected.bytes) throw new Error();
    execution = { status: "completed", nodeId, sourceRevision: revision, taskId: task.id,
      executionEpoch: task.result.executionEpoch, ...expected, signedResultAccepted: true,
      reusedExistingExecution: true, executionObservedAt: task.result.observedAt };
  } else {
    stage = "execute"; console.log("PC_TASK_STAGE=" + stage);
    execution = await executeLocalPcWork({ base, revision, identity, taskId: task.id });
    if (execution.taskId !== task.id || execution.status !== "completed" || execution.sha256 !== expected.sha256) throw new Error();
  }
  stage = "verify"; console.log("PC_TASK_STAGE=" + stage);
  const after = snapshot();
  if (!isDeepStrictEqual(after.identities, before.identities) ||
    !isDeepStrictEqual(after.state.fleet.filter((n: { kind: string }) => n.kind === "android"),
      before.state.fleet.filter((n: { kind: string }) => n.kind === "android"))) throw new Error();
  const receipt = { version: 1, issue: 1662, goalIssue: 1219, ...execution, fingerprint: identity.fingerprint,
    androidCount: 38, androidRecordsPreserved: true, identitiesPreserved: true,
    observedAt: new Date().toISOString(), evidenceClass: "MACHINE_VERIFIED" };
  await new FilePcIdentityStorage(join(root, `task-evidence-${revision}.${platform === "windows" ? "dpapi" : "json"}`))
    .writeExclusive(JSON.stringify(receipt)).catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Existing receipt remains retained; retry never overwrites Evidence.
    });
  stage = "complete"; console.log("PC_TASK_STAGE=" + stage);
  console.log(JSON.stringify(receipt));
}
main().catch(() => { console.error(JSON.stringify({ version: 1, issue: 1662, failedStage: stage,
  failureReason: "PC_TASK_EXECUTION_REJECTED", complete: false, retainedExistingKeysAndState: true }));
  process.exitCode = 1; });
