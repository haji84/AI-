import { createHash } from "node:crypto";

export type Reversibility = "REVERSIBLE" | "HARD_TO_REVERSE" | "IRREVERSIBLE";
export type SurfaceKind =
  | "repository" | "github_rules" | "ci" | "permission_metadata"
  | "secret_metadata" | "agent_config" | "workflow_gate_risk"
  | "external_integration" | "runtime" | "durable_state";

export interface BaselineSurface {
  kind: SurfaceKind;
  id: string;
  state: unknown;
  dependencies?: string[];
}

export interface BaselineSnapshot {
  id: string;
  goalId: string;
  issue?: number;
  capturedAt: string;
  sourceRevision: string;
  surfaces: BaselineSurface[];
  digest: string;
}

export interface ChangeSet {
  id: string;
  baselineId: string;
  goalId: string;
  issue?: number;
  actor: string;
  reason: string;
  timestamp: string;
  targets: string[];
  dependencies: string[];
  beforeRefs: string[];
  afterRefs: string[];
  verificationEvidence: string[];
  rollbackProcedure: string[];
  reversibility: Reversibility;
}

export interface RollbackRequest {
  baseline: BaselineSnapshot;
  changeSets: ChangeSet[];
  targetIds?: string[];
  evidenceRevision: string;
}

export type RollbackDecision =
  | { status: "READY"; restoreTargets: string[]; requiredVerification: string[] }
  | { status: "HUMAN_REQUIRED"; reason: string }
  | { status: "BLOCKED"; reason: string };

const secretKey = /(secret|token|password|passwd|api[_-]?key|private[_-]?key|credential)/i;
const allowedSecretMetadata = /^(name|scope|version|fingerprint|updatedAt|provider)$/;

function assertNoSecretValues(value: unknown, path = "root"): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecretValues(item, `${path}[${i}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (secretKey.test(key) && !allowedSecretMetadata.test(key)) {
      throw new Error(`SECRET_VALUE_REJECTED:${path}.${key}`);
    }
    assertNoSecretValues(child, `${path}.${key}`);
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + stable(v)).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createBaseline(input: Omit<BaselineSnapshot, "digest">): BaselineSnapshot {
  assertNoSecretValues(input.surfaces);
  const digest = createHash("sha256").update(stable(input)).digest("hex");
  return { ...input, digest };
}

export function verifyBaseline(snapshot: BaselineSnapshot): boolean {
  const { digest, ...rest } = snapshot;
  try {
    assertNoSecretValues(rest.surfaces);
  } catch {
    return false;
  }
  return createHash("sha256").update(stable(rest)).digest("hex") === digest;
}

export function classifyMutation(input: {
  destructive?: boolean;
  databaseMigration?: boolean;
  permissionChange?: boolean;
  credentialChange?: boolean;
  securityGovernanceChange?: boolean;
  compensatingAction?: boolean;
}): Reversibility {
  if (input.destructive || input.databaseMigration) {
    return input.compensatingAction ? "HARD_TO_REVERSE" : "IRREVERSIBLE";
  }
  if (input.permissionChange || input.credentialChange || input.securityGovernanceChange) {
    return "HARD_TO_REVERSE";
  }
  return "REVERSIBLE";
}

export function planRollback(request: RollbackRequest): RollbackDecision {
  if (!verifyBaseline(request.baseline)) return { status: "BLOCKED", reason: "BASELINE_INVALID" };
  if (request.evidenceRevision !== request.baseline.sourceRevision) {
    return { status: "BLOCKED", reason: "STALE_BASELINE_EVIDENCE" };
  }
  if (request.changeSets.some((c) => c.reversibility !== "REVERSIBLE")) {
    return { status: "HUMAN_REQUIRED", reason: "NON_REVERSIBLE_OR_PRIVILEGED_CHANGE" };
  }
  const all = new Set(request.changeSets.flatMap((c) => c.targets));
  const selected = new Set(request.targetIds ?? [...all]);
  for (const change of request.changeSets) {
    if (!change.targets.some((t) => selected.has(t))) continue;
    for (const dep of change.dependencies) {
      if (all.has(dep) && !selected.has(dep)) {
        return { status: "BLOCKED", reason: `DEPENDENCY_INCONSISTENT:${dep}` };
      }
    }
  }
  return {
    status: "READY",
    restoreTargets: [...selected].sort(),
    requiredVerification: ["ci", "verifier", "security", "runtime", "goal_progress"],
  };
}

export function restorationComplete(input: {
  decision: RollbackDecision;
  evidence: Record<string, boolean>;
}): boolean {
  if (input.decision.status !== "READY") return false;
  return input.decision.requiredVerification.every((key) => input.evidence[key] === true);
}
