import { posix } from "node:path";

export type DevelopmentChangeSetStatus = "LOCAL" | "VERIFIED" | "READY_TO_PUBLISH" | "PUBLISHED" | "REJECTED";

export interface DevelopmentRollbackReference {
  kind: "git-base" | "reverse-patch" | "known-good-artifact";
  reference: string;
}

export interface DevelopmentChangeSet {
  version: 1;
  changeSetId: string;
  jobId: string;
  workItemId: string;
  deviceId: string;
  baseRevision: string;
  changedPaths: string[];
  affectedSymbols: string[];
  patchDigest: string;
  evidenceDigest: string;
  rollback: DevelopmentRollbackReference;
  status: DevelopmentChangeSetStatus;
  createdAt: string;
  updatedAt: string;
}

export type DevelopmentChangeSetCreateInput = Omit<DevelopmentChangeSet, "version" | "status" | "createdAt" | "updatedAt">;

const SECRET_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|secret|token|recovery[_ -]?code)\s*[:=]\s*[^\s,;]+/i;

function required(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
}

function safePath(value: string): string {
  const path = posix.normalize(value.replaceAll("\\", "/"));
  if (!path || path === "." || path === ".." || path.startsWith("../") || path.startsWith("/")) throw new Error(`unsafe path: ${value}`);
  return path;
}

export function assertDevelopmentChangeSet(value: DevelopmentChangeSet): void {
  if (value.version !== 1) throw new Error("invalid development Change Set version");
  for (const [name, text] of [["changeSetId", value.changeSetId], ["jobId", value.jobId], ["workItemId", value.workItemId], ["deviceId", value.deviceId]] as const) required(text, name);
  if (!/^[a-f0-9]{40,64}$/.test(value.baseRevision)) throw new Error("invalid Change Set base revision");
  if (!/^[a-f0-9]{64}$/.test(value.patchDigest) || !/^[a-f0-9]{64}$/.test(value.evidenceDigest)) throw new Error("invalid Change Set digest");
  if (!value.changedPaths.length) throw new Error("Change Set changed paths are required");
  value.changedPaths.forEach(safePath);
  required(value.rollback?.reference, "rollback reference");
  if (SECRET_PATTERN.test(JSON.stringify({
    changeSetId: value.changeSetId,
    jobId: value.jobId,
    workItemId: value.workItemId,
    deviceId: value.deviceId,
    changedPaths: value.changedPaths,
    affectedSymbols: value.affectedSymbols,
    rollback: value.rollback,
  }))) throw new Error("secret-bearing Change Set metadata is prohibited");
  if (!Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("invalid Change Set timestamp");
}

export function createDevelopmentChangeSet(input: DevelopmentChangeSetCreateInput, now = new Date()): DevelopmentChangeSet {
  const at = now.toISOString();
  const value: DevelopmentChangeSet = {
    version: 1,
    ...structuredClone(input),
    changedPaths: [...new Set(input.changedPaths.map(safePath))].sort(),
    affectedSymbols: [...new Set(input.affectedSymbols)].sort(),
    status: "LOCAL",
    createdAt: at,
    updatedAt: at,
  };
  assertDevelopmentChangeSet(value);
  return value;
}

