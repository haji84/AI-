import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Goal } from "./goal-loop.ts";
import { validateResidentDevelopmentSequence, type ResidentDevelopmentSequence } from "./resident-development-sequence.ts";
import { assertSignedFileAcceptanceContracts, type SignedFileAcceptanceContract } from "./resident-signed-acceptance.ts";
import { assertExternalRuntimePath, readBoundedRuntimeFile } from "./resident-runtime-files.ts";
import { localOllamaFixtureSourcePath, localOllamaFixtureTestPath } from "./local-ollama-tdd.ts";

export interface ResidentJobExecution {
  key: string;
  workspace: string;
  targetPath: string;
  allowedFiles: string[];
  receiptFile: string;
  publicKeyFile: string;
  publicKeySha256: string;
  tddProfile: "python_add_v1";
  acceptance: SignedFileAcceptanceContract[];
}
export interface ResidentExecutionManifest {
  version: 1;
  sequence: ResidentDevelopmentSequence;
  executions: ResidentJobExecution[];
}
const samePath = (value: string) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
const contains = (parent: string, child: string) => {
  const diff = relative(parent, child);
  return !diff || (!isAbsolute(diff) && diff !== ".." && !diff.startsWith(".." + sep));
};

/** The digest and path come exclusively from host configuration, never Goal text or model output.
 * Each Job uses a distinct pre-provisioned worktree and receipt; this loader grants no OS access.
 */
export function readResidentExecutionManifest(
  env: Record<string, string | undefined>, runtimeRoot: string, goal?: Goal,
): ResidentExecutionManifest | null {
  const file = env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_FILE?.trim();
  const pin = env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256?.trim();
  if (!file && !pin) return null;
  if (!file || !/^[a-f0-9]{64}$/.test(pin ?? "")) throw Error("RESIDENT_MANIFEST_PIN_REQUIRED");
  const bytes = readBoundedRuntimeFile(file, 131072);
  if (createHash("sha256").update(bytes).digest("hex") !== pin) throw Error("RESIDENT_MANIFEST_PIN_MISMATCH");
  const manifest = JSON.parse(bytes.toString("utf8")) as ResidentExecutionManifest;
  if (!manifest || Object.keys(manifest).sort().join(",") !== "executions,sequence,version" || manifest.version !== 1
    || !manifest.sequence || !Array.isArray(manifest.sequence.jobs) || !Array.isArray(manifest.executions)
    || !manifest.executions.length || manifest.executions.length > 32
    || manifest.executions.length !== manifest.sequence.jobs.length) throw Error("RESIDENT_MANIFEST_INVALID");
  if (goal) validateResidentDevelopmentSequence(manifest.sequence, goal, {
    taskScopeId: manifest.sequence.taskScopeId, maxRisk: manifest.sequence.maxRisk,
  });
  const workspaces: string[] = [], receipts = new Set<string>(), keys = new Set<string>();
  for (const execution of manifest.executions) {
    if (!execution || Object.keys(execution).sort().join(",") !== "acceptance,allowedFiles,key,publicKeyFile,publicKeySha256,receiptFile,targetPath,tddProfile,workspace"
      || keys.has(execution.key) || !manifest.sequence.jobs.some(job => job.key === execution.key)
      || typeof execution.workspace !== "string" || !isAbsolute(execution.workspace)
      || execution.tddProfile !== "python_add_v1" || execution.targetPath !== localOllamaFixtureSourcePath
      || !Array.isArray(execution.allowedFiles) || execution.allowedFiles.length !== 2
      || !execution.allowedFiles.includes(localOllamaFixtureSourcePath) || !execution.allowedFiles.includes(localOllamaFixtureTestPath)
      || typeof execution.receiptFile !== "string" || !isAbsolute(execution.receiptFile)
      || typeof execution.publicKeyFile !== "string" || !isAbsolute(execution.publicKeyFile)
      || !Array.isArray(execution.acceptance)
      || !/^[a-f0-9]{64}$/.test(execution.publicKeySha256)) throw Error("RESIDENT_MANIFEST_EXECUTION_INVALID");
    const job = manifest.sequence.jobs.find(job => job.key === execution.key)!;
    if (job.targetFiles.length !== execution.allowedFiles.length || job.targetFiles.some(path => !execution.allowedFiles.includes(path))) throw Error("RESIDENT_MANIFEST_TARGET_MISMATCH");
    assertExternalRuntimePath(execution.workspace, []);
    const workspace = samePath(realpathSync(execution.workspace));
    if (workspace === samePath(runtimeRoot) || workspaces.some(other => contains(other, workspace) || contains(workspace, other))) throw Error("RESIDENT_MANIFEST_WORKSPACE_OVERLAP");
    workspaces.push(workspace); keys.add(execution.key);
    if (receipts.has(samePath(execution.receiptFile))) throw Error("RESIDENT_MANIFEST_RECEIPT_OVERLAP");
    receipts.add(samePath(execution.receiptFile));
    if (goal) assertSignedFileAcceptanceContracts(execution.acceptance, job.criterionIds.map(id => ({
      id, description: goal.successCriteria[Number(id.slice("criterion-".length)) - 1]!, required: true,
    })));
    // Validate structure even when the Broker loads wake paths before a Goal exists.
    if (!goal) assertSignedFileAcceptanceContracts(execution.acceptance, execution.acceptance.map(contract => ({
      id: contract?.criterionId, description: contract?.description, required: true,
    })));
    if (execution.acceptance.some(contract => contract.expectedFiles.some(f => !execution.allowedFiles.includes(f.path)))) throw Error("RESIDENT_MANIFEST_ACCEPTANCE_PATH_INVALID");
  }
  if (receipts.has(samePath(file)) || manifest.executions.some(e => receipts.has(samePath(e.publicKeyFile)) || samePath(e.publicKeyFile) === samePath(file))) {
    throw Error("RESIDENT_MANIFEST_AUTHORITY_OVERLAP");
  }
  for (const authority of [file, ...manifest.executions.flatMap(e => [e.receiptFile, e.publicKeyFile])]) {
    assertExternalRuntimePath(authority, workspaces);
  }
  return manifest;
}
