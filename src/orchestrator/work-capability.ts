import type { RiskLevel } from "./goal-loop.ts";

export type WorkDomain =
  | "software"
  | "spreadsheet"
  | "document"
  | "browser"
  | "device"
  | "research"
  | "file";

export type WorkAccess = "read" | "write" | "act";

export interface WorkResourceScope {
  kind: string;
  ids: string[];
}

export interface WorkVerifierContract {
  kind: string;
  required: boolean;
  spec: Record<string, unknown>;
}

export interface WorkAction {
  goalId: string;
  jobId: string;
  attemptId: string;
  strategyId: string;
  capability: string;
  domain: WorkDomain;
  operation: string;
  input: Record<string, unknown>;
  scope: WorkResourceScope[];
  expectedOutputs: string[];
  risk: RiskLevel;
  access: WorkAccess;
  externalSideEffect: boolean;
  irreversible: boolean;
  idempotencyKey?: string;
  verifier: WorkVerifierContract;
}

export interface WorkEvidence {
  kind: string;
  ref?: string;
  data?: unknown;
}

export interface WorkChange {
  resource: string;
  operation: string;
  reversible: boolean;
  rollbackHint?: string;
}

export interface WorkResult {
  ok: boolean;
  status: "completed" | "failed" | "blocked";
  outputs: Record<string, unknown>;
  changes: WorkChange[];
  evidence: WorkEvidence[];
  failureClass?: "transient" | "implementation" | "environment" | "verification" | "policy" | "unknown";
  error?: string;
  provenance: {
    capability: string;
    attemptId: string;
    strategyId: string;
  };
}

export interface WorkCapability {
  name: string;
  domain: WorkDomain;
  operations: string[];
  access: WorkAccess;
  externalSideEffect: boolean;
  maxRisk: RiskLevel;
  requiresHumanApproval: boolean;
  available(): Promise<boolean>;
  execute(action: WorkAction): Promise<WorkResult>;
}

export interface WorkCapabilityCatalogEntry {
  name: string;
  domain: WorkDomain;
  operations: string[];
  access: WorkAccess;
  externalSideEffect: boolean;
  maxRisk: RiskLevel;
  requiresHumanApproval: boolean;
  available: boolean;
}

export class WorkCapabilityRegistry {
  private readonly capabilities = new Map<string, WorkCapability>();

  register(capability: WorkCapability): this {
    if (!capability.name.trim()) throw new Error("work capability name must not be empty");
    if (this.capabilities.has(capability.name)) throw new Error(`work capability already registered: ${capability.name}`);
    this.capabilities.set(capability.name, capability);
    return this;
  }

  get(name: string): WorkCapability | undefined {
    return this.capabilities.get(name);
  }

  async catalog(): Promise<WorkCapabilityCatalogEntry[]> {
    const entries: WorkCapabilityCatalogEntry[] = [];
    for (const capability of this.capabilities.values()) {
      entries.push({
        name: capability.name,
        domain: capability.domain,
        operations: [...capability.operations],
        access: capability.access,
        externalSideEffect: capability.externalSideEffect,
        maxRisk: capability.maxRisk,
        requiresHumanApproval: capability.requiresHumanApproval,
        available: await capability.available(),
      });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }
}
