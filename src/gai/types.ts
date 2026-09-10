export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type MemoryKind = "working" | "episodic" | "semantic" | "procedural";

export type ModelTier = "local" | "sol" | "astra";

export interface Goal {
  id: string;
  title: string;
  description: string;
  successCriteria: string[];
  risk: RiskLevel;
  createdAt: string;
  status: "queued" | "active" | "blocked" | "completed" | "failed";
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  content: string;
  source?: string;
  confidence: number;
  tags: string[];
  createdAt: string;
  lastUsedAt?: string;
}

export interface Prediction {
  action: string;
  expectedOutcome: string;
  confidence: number;
}

export interface Observation {
  actualOutcome: string;
  success: boolean;
  evidence: string[];
}

export interface LearningRecord {
  prediction: Prediction;
  observation: Observation;
  lesson: string;
  transferableRule?: string;
}

export interface TaskProfile {
  id: string;
  description: string;
  difficulty: number;
  requiresFrontierReasoning?: boolean;
  requiresLongContext?: boolean;
  requiresToolUse?: boolean;
  risk: RiskLevel;
}

export interface ModelRoute {
  tier: ModelTier;
  reason: string;
  fallback: ModelTier[];
  additionalApiCostAllowed: false;
}

export interface VerificationResult {
  passed: boolean;
  score: number;
  evidence: string[];
  failures: string[];
}

export interface ImprovementCandidate {
  id: string;
  parentVersion: string;
  hypothesis: string;
  changedComponents: string[];
  benchmarkBefore: number;
  benchmarkAfter?: number;
  status: "candidate" | "accepted" | "rejected";
}
