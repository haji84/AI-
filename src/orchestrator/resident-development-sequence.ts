import { createHash } from "node:crypto";
import type { DevelopmentJob, DevelopmentRisk } from "./development-job.ts";
import type { Goal } from "./goal-loop.ts";

export interface ResidentDevelopmentSequenceJob {
  key: string;
  objective: string;
  criterionIds: string[];
  targetFiles: string[];
  baseRevision: string;
}

/** Host-approved, bounded work; this contract does not confer release authority. */
export interface ResidentDevelopmentSequence {
  version: 1;
  goalDigest: string;
  taskScopeId: string;
  maxRisk: DevelopmentRisk;
  expiresAt: string;
  completionMode: "release" | "verified-local-artifact";
  /** Concrete host adapter binding, including acceptance, paths and verifier pins. */
  executionContractDigest?: string;
  jobs: ResidentDevelopmentSequenceJob[];
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const RESIDENT_SEQUENCE_EVIDENCE_KIND = "resident-development-sequence:v1";

export function residentDevelopmentGoalDigest(goal: Goal): string {
  return digest({ title: goal.title, description: goal.description, successCriteria: goal.successCriteria, constraints: goal.constraints });
}

export function residentDevelopmentSequenceDigest(sequence: ResidentDevelopmentSequence): string {
  return digest({ version: sequence.version, goalDigest: sequence.goalDigest, taskScopeId: sequence.taskScopeId,
    maxRisk: sequence.maxRisk, expiresAt: sequence.expiresAt, completionMode: sequence.completionMode,
    ...(sequence.executionContractDigest ? { executionContractDigest: sequence.executionContractDigest } : {}),
    jobs: sequence.jobs.map(job => ({ key: job.key, objective: job.objective, criterionIds: job.criterionIds,
      targetFiles: job.targetFiles, baseRevision: job.baseRevision })) });
}

export function validateResidentDevelopmentSequence(sequence: ResidentDevelopmentSequence, goal: Goal,
  scope: { taskScopeId: string; maxRisk: DevelopmentRisk }, now = new Date()): void {
  if (!sequence || sequence.version !== 1 || sequence.goalDigest !== residentDevelopmentGoalDigest(goal)) throw Error("SEQUENCE_GOAL_MISMATCH");
  if (sequence.executionContractDigest !== undefined && !/^[a-f0-9]{64}$/.test(sequence.executionContractDigest)) throw Error("SEQUENCE_EXECUTION_CONTRACT_INVALID");
  if (sequence.taskScopeId !== scope.taskScopeId || !sequence.taskScopeId.trim()
    || sequence.maxRisk !== scope.maxRisk || !["low", "medium", "high", "critical"].includes(sequence.maxRisk)) throw Error("SEQUENCE_SCOPE_MISMATCH");
  if (!Number.isFinite(Date.parse(sequence.expiresAt)) || Date.parse(sequence.expiresAt) <= now.getTime()) throw Error("SEQUENCE_EXPIRED");
  if (!["release", "verified-local-artifact"].includes(sequence.completionMode)
    || (sequence.completionMode === "verified-local-artifact" && sequence.maxRisk !== "low")) throw Error("SEQUENCE_COMPLETION_MODE_INVALID");
  if (!Array.isArray(sequence.jobs) || !sequence.jobs.length || sequence.jobs.length > 32
    || !goal.successCriteria.length || goal.successCriteria.length > 32
    || goal.successCriteria.some(criterion => typeof criterion !== "string" || !criterion.trim())) throw Error("SEQUENCE_BOUNDS_INVALID");
  const criteria = new Set(goal.successCriteria.map((_, index) => `criterion-${index + 1}`));
  const assigned = new Set<string>(), keys = new Set<string>();
  for (const job of sequence.jobs) {
    if (!job || typeof job.key !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(job.key) || keys.has(job.key)
      || typeof job.objective !== "string" || !job.objective.trim() || !/^[a-f0-9]{40,64}$/.test(job.baseRevision)) throw Error("SEQUENCE_JOB_INVALID");
    keys.add(job.key);
    if (!Array.isArray(job.criterionIds) || !job.criterionIds.length || job.criterionIds.length > 32) throw Error("SEQUENCE_CRITERIA_INVALID");
    for (const id of job.criterionIds) {
      if (!criteria.has(id) || assigned.has(id)) throw Error("SEQUENCE_CRITERIA_INVALID");
      assigned.add(id);
    }
    if (!Array.isArray(job.targetFiles) || !job.targetFiles.length || job.targetFiles.length > 128
      || new Set(job.targetFiles).size !== job.targetFiles.length
      || job.targetFiles.some(path => typeof path !== "string" || !path || path !== path.trim()
        || /[\\:]/.test(path) || [...path].some(character => character.charCodeAt(0) < 32)
        || path.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git"))) throw Error("SEQUENCE_TARGET_FILES_INVALID");
  }
  if (assigned.size !== criteria.size) throw Error("SEQUENCE_CRITERIA_INCOMPLETE");
}

export function residentDevelopmentSequenceJobId(goalId: string, sequence: ResidentDevelopmentSequence, key: string): string {
  if (!sequence.jobs.some(job => job.key === key)) throw Error("SEQUENCE_JOB_KEY_UNKNOWN");
  return `development-${digest({ goalId, sequenceDigest: residentDevelopmentSequenceDigest(sequence), key })}`;
}

/** Reject drift and select exactly one approved successor after its predecessor completes. */
export function selectResidentDevelopmentSequenceJob(sequence: ResidentDevelopmentSequence, goalId: string,
  persistedJobs: DevelopmentJob[]): { definition: ResidentDevelopmentSequenceJob; job: DevelopmentJob | null } | null {
  const sequenceDigest = residentDevelopmentSequenceDigest(sequence);
  const definitions = new Map(sequence.jobs.map(definition => [residentDevelopmentSequenceJobId(goalId, sequence, definition.key), definition]));
  for (const job of persistedJobs) {
    const definition = definitions.get(job.jobId);
    const binding = job.evidence.filter(item => item.kind === RESIDENT_SEQUENCE_EVIDENCE_KIND);
    if (!definition || job.goalId !== goalId || binding.length !== 1
      || binding[0]!.artifactDigest !== sequenceDigest || binding[0]!.sourceRevision !== sequence.goalDigest
      || binding[0]!.environment !== definition.key || binding[0]!.issuer !== "resident-development-host" || binding[0]!.verified
      || job.baseRevision !== definition.baseRevision || job.approvalScope.taskScopeId !== sequence.taskScopeId
      || job.approvalScope.maxRisk !== sequence.maxRisk || job.approvalScope.expiresAt !== sequence.expiresAt
      || JSON.stringify(job.definitionOfDone.map(item => item.id)) !== JSON.stringify(definition.criterionIds)
      || job.definitionOfDone.some(item => !item.required) || job.phase === "CANCELLED") throw Error("SEQUENCE_PERSISTED_JOB_MISMATCH");
  }
  let selected: { definition: ResidentDevelopmentSequenceJob; job: DevelopmentJob | null } | null = null;
  for (const definition of sequence.jobs) {
    const job = persistedJobs.find(item => item.jobId === residentDevelopmentSequenceJobId(goalId, sequence, definition.key)) ?? null;
    if (selected && job) throw Error("SEQUENCE_PERSISTED_ORDER_MISMATCH");
    if (!selected && job?.phase !== "COMPLETED") selected = { definition, job };
  }
  return selected;
}
