import { createHash } from "node:crypto";

import { PersistentMemoryStore } from "./memory-store.ts";
import {
  PersistentSkillLibrary,
  type SkillConstraints,
  type SkillRecord,
} from "./skill-library.ts";
import type { MemoryRecord } from "./types.ts";

export type WorkLearningOutcome = "COMPLETED" | "FAILED" | "BLOCKED";
export type WorkRecoveryAction = "retry_same" | "repair" | "strategy_pivot" | "human_takeover";

export interface WorkLearningAttempt {
  id: string;
  strategyId: string;
  procedure: string;
  resultOk: boolean;
  verifierPassed: boolean;
  evidenceRefs: string[];
  recovery?: {
    action: WorkRecoveryAction;
    reason: string;
  };
}

export interface WorkLearningTrace {
  goalId: string;
  goalSummary: string;
  capability: string;
  applicability: string[];
  plan: string[];
  attempts: WorkLearningAttempt[];
  outcome: WorkLearningOutcome;
  completedAt: string;
  constraints?: SkillConstraints;
}

export type WorkLearningStatus =
  | "CANDIDATE_CREATED"
  | "IDEMPOTENT_REPLAY"
  | "NEGATIVE_EPISODE_RECORDED"
  | "REJECTED_UNVERIFIED";

export interface WorkLearningResult {
  status: WorkLearningStatus;
  traceDigest: string;
  episode: MemoryRecord | null;
  procedure: MemoryRecord | null;
  skill: SkillRecord | null;
  reason: string;
}

const MAX_PLAN_STEPS = 32;
const MAX_ATTEMPTS = 32;
const MAX_EVIDENCE_REFS = 64;
const MAX_TEXT = 2_048;
const MAX_EVIDENCE_REF = 256;
const CREDENTIAL_ASSIGNMENT = /(?:password|passwd|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization|cookie)\s*[:=]\s*\S+/i;
const BEARER_CREDENTIAL = /\bbearer\s+[a-z0-9._~+/=-]{8,}/i;
const SECRET_KEY = /\bsk-[a-z0-9_-]{8,}/i;

function boundedText(value: string, field: string, max = MAX_TEXT): string {
  const text = value.trim();
  if (!text) throw new Error(`${field} is required`);
  if (text.length > max) throw new Error(`${field} exceeds ${max} characters`);
  if (CREDENTIAL_ASSIGNMENT.test(text) || BEARER_CREDENTIAL.test(text) || SECRET_KEY.test(text)) {
    throw new Error(`${field} contains credential-like material`);
  }
  return text;
}

function uniqueBounded(values: string[], field: string, maxItems: number, maxText = MAX_TEXT): string[] {
  if (values.length > maxItems) throw new Error(`${field} exceeds ${maxItems} items`);
  return [...new Set(values.map((value, index) => boundedText(value, `${field}[${index}]`, maxText)))];
}

function canonicalTrace(trace: WorkLearningTrace) {
  const goalId = boundedText(trace.goalId, "goalId", 256);
  const goalSummary = boundedText(trace.goalSummary, "goalSummary");
  const capability = boundedText(trace.capability, "capability", 256);
  const applicability = uniqueBounded(trace.applicability, "applicability", 32, 256).sort();
  const plan = uniqueBounded(trace.plan, "plan", MAX_PLAN_STEPS);
  if (applicability.length === 0) throw new Error("applicability is required");
  if (plan.length === 0) throw new Error("plan is required");
  if (trace.attempts.length === 0 || trace.attempts.length > MAX_ATTEMPTS) {
    throw new Error(`attempts must contain 1-${MAX_ATTEMPTS} items`);
  }
  const completedAt = new Date(trace.completedAt);
  if (Number.isNaN(completedAt.getTime())) throw new Error("completedAt must be a valid timestamp");

  const ids = new Set<string>();
  let evidenceCount = 0;
  const attempts = trace.attempts.map((attempt, index) => {
    const id = boundedText(attempt.id, `attempts[${index}].id`, 256);
    if (ids.has(id)) throw new Error(`duplicate attempt id: ${id}`);
    ids.add(id);
    const strategyId = boundedText(attempt.strategyId, `attempts[${index}].strategyId`, 256);
    const procedure = boundedText(attempt.procedure, `attempts[${index}].procedure`);
    const evidenceRefs = uniqueBounded(
      attempt.evidenceRefs,
      `attempts[${index}].evidenceRefs`,
      MAX_EVIDENCE_REFS,
      MAX_EVIDENCE_REF,
    );
    evidenceCount += evidenceRefs.length;
    if (evidenceRefs.length === 0) throw new Error(`attempt ${id} requires evidence references`);
    if (!attempt.resultOk && attempt.verifierPassed) {
      throw new Error(`attempt ${id} cannot pass verification when execution failed`);
    }
    const isFinal = index === trace.attempts.length - 1;
    const succeeded = attempt.resultOk && attempt.verifierPassed;
    if (!isFinal && succeeded) throw new Error(`attempt ${id} passed before the final attempt`);
    if (!isFinal && !succeeded && !attempt.recovery) {
      throw new Error(`attempt ${id} requires a recovery decision before the next attempt`);
    }
    const recovery = attempt.recovery
      ? {
          action: attempt.recovery.action,
          reason: boundedText(attempt.recovery.reason, `attempts[${index}].recovery.reason`),
        }
      : undefined;
    return {
      id,
      strategyId,
      procedure,
      resultOk: attempt.resultOk,
      verifierPassed: attempt.verifierPassed,
      evidenceRefs,
      recovery,
    };
  });
  if (evidenceCount > MAX_EVIDENCE_REFS) {
    throw new Error(`trace evidence references exceed ${MAX_EVIDENCE_REFS} items`);
  }

  const finalAttempt = attempts.at(-1)!;
  const verifiedCompletion =
    trace.outcome === "COMPLETED" && finalAttempt.resultOk && finalAttempt.verifierPassed;
  if (trace.outcome === "COMPLETED" && !verifiedCompletion) {
    return {
      valid: false as const,
      goalId,
      goalSummary,
      capability,
      applicability,
      plan,
      attempts,
      outcome: trace.outcome,
      completedAt: completedAt.toISOString(),
      constraints: trace.constraints,
      reason: "COMPLETED work cannot be learned without final execution and verifier PASS",
    };
  }

  return {
    valid: true as const,
    goalId,
    goalSummary,
    capability,
    applicability,
    plan,
    attempts,
    outcome: trace.outcome,
    completedAt: completedAt.toISOString(),
    constraints: trace.constraints,
    verifiedCompletion,
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class VerifiedWorkLearningEngine {
  private readonly memory: PersistentMemoryStore;
  private readonly skills: PersistentSkillLibrary;

  constructor(memory: PersistentMemoryStore, skills: PersistentSkillLibrary) {
    this.memory = memory;
    this.skills = skills;
  }

  async learn(trace: WorkLearningTrace): Promise<WorkLearningResult> {
    const normalized = canonicalTrace(trace);
    const traceDigest = digest(normalized);
    if (!normalized.valid) {
      return {
        status: "REJECTED_UNVERIFIED",
        traceDigest,
        episode: null,
        procedure: null,
        skill: null,
        reason: normalized.reason,
      };
    }

    const baseId = `verified-work:${traceDigest.slice(0, 24)}`;
    const evidenceRefs = [...new Set(normalized.attempts.flatMap((attempt) => attempt.evidenceRefs))];
    const episode = await this.memory.upsert({
      id: `${baseId}:episode`,
      kind: "episodic",
      content: JSON.stringify({
        capability: normalized.capability,
        applicability: normalized.applicability,
        plan: normalized.plan,
        attempts: normalized.attempts.map((attempt) => ({
          id: attempt.id,
          strategyId: attempt.strategyId,
          resultOk: attempt.resultOk,
          verifierPassed: attempt.verifierPassed,
          recovery: attempt.recovery,
          evidenceRefs: attempt.evidenceRefs,
        })),
        outcome: normalized.outcome,
      }),
      source: `goal:${normalized.goalId}:trace:${traceDigest}`,
      confidence: normalized.verifiedCompletion ? 0.9 : 0.7,
      tags: normalized.verifiedCompletion
        ? ["verified-work", "successful-experience", `capability:${normalized.capability}`]
        : ["verified-work", "negative-experience", "do-not-promote", `capability:${normalized.capability}`],
      createdAt: normalized.completedAt,
    });

    if (!normalized.verifiedCompletion) {
      return {
        status: "NEGATIVE_EPISODE_RECORDED",
        traceDigest,
        episode,
        procedure: null,
        skill: null,
        reason: "evidence-backed failed/blocked work is retained as negative experience only",
      };
    }

    const finalAttempt = normalized.attempts.at(-1)!;
    const failedAttempts = normalized.attempts.filter(
      (attempt) => !attempt.resultOk || !attempt.verifierPassed,
    ).length;
    const confidence = Math.max(0.55, 0.9 - failedAttempts * 0.08);
    const procedure = await this.memory.upsert({
      id: `${baseId}:procedure`,
      kind: "procedural",
      content: finalAttempt.procedure,
      source: episode.id,
      confidence,
      tags: ["verified", "procedure", "candidate-only", `capability:${normalized.capability}`],
      createdAt: normalized.completedAt,
    });

    const skillId = `learned-${digest({ capability: normalized.capability, applicability: normalized.applicability }).slice(0, 24)}`;
    const existing = await this.skills.get(skillId);
    const traceRef = `trace:${traceDigest}`;
    if (existing?.provenance.includes(traceRef)) {
      return {
        status: "IDEMPOTENT_REPLAY",
        traceDigest,
        episode,
        procedure,
        skill: existing,
        reason: "the same verified work trace is already represented by this candidate",
      };
    }

    const skill = await this.skills.createCandidate({
      id: skillId,
      name: `Learned ${normalized.capability}`,
      description: `Evidence-verified workflow candidate for ${normalized.capability}`,
      procedure: finalAttempt.procedure,
      applicability: normalized.applicability,
      evidence: [...evidenceRefs, `memory:${episode.id}`, `memory:${procedure.id}`, traceRef],
      verificationPassed: true,
      success: true,
      confidence,
      source: `goal:${normalized.goalId}`,
      constraints: normalized.constraints,
    });
    if (!skill) throw new Error("verified work candidate creation unexpectedly failed");

    return {
      status: "CANDIDATE_CREATED",
      traceDigest,
      episode,
      procedure,
      skill,
      reason: "verified work became durable memory and a non-active skill candidate",
    };
  }
}
