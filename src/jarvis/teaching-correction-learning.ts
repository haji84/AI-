import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  TeachingStore,
  type TeachingStep,
  type TeachingVariant,
} from "./teaching.ts";
import {
  VerifiedWorkLearningEngine,
  type WorkLearningResult,
} from "../gai/work-learning.ts";

export type TeachingCorrectionStatus = "RETURN_REQUIRED" | "RETURNED" | "CORRECTED";

export interface TeachingCorrectionRecord {
  id: string;
  sourceVariantId: string;
  mistakenStepIndex: number;
  preErrorSignature: string;
  mistakenAfterSignature: string;
  status: TeachingCorrectionStatus;
  resumeStepCount?: number;
  correctedStepIndex?: number;
  derivedVariantId?: string;
  createdAt: string;
  returnedAt?: string;
  correctedAt?: string;
}

interface TeachingCorrectionFile {
  version: 1;
  corrections: TeachingCorrectionRecord[];
}

const MAX_CORRECTIONS = 2_000;
const MAX_ID = 160;
const SHA256 = /^[a-f0-9]{64}$/;
const VALID_STATUSES = new Set<TeachingCorrectionStatus>([
  "RETURN_REQUIRED",
  "RETURNED",
  "CORRECTED",
]);

function boundedId(value: unknown, field: string): string {
  if (typeof value !== "string") throw Error(`${field} must be a string`);
  const text = value.trim();
  if (!text || text.length > MAX_ID || [...text].some((character) => character.charCodeAt(0) < 32)) {
    throw Error(`Invalid ${field}`);
  }
  return text;
}

function signature(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) throw Error(`Invalid ${field}`);
  return value;
}

function integerIndex(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    throw Error(`Invalid ${field}`);
  }
  return value as number;
}

function parseTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw Error(`Invalid ${field}`);
  return value;
}

function normalizeRecord(value: unknown): TeachingCorrectionRecord {
  if (!value || typeof value !== "object") throw Error("Invalid correction record");
  const record = value as Partial<TeachingCorrectionRecord>;
  const status = record.status;
  if (!status || !VALID_STATUSES.has(status)) throw Error("Invalid correction status");
  const normalized: TeachingCorrectionRecord = {
    id: boundedId(record.id, "correction id"),
    sourceVariantId: boundedId(record.sourceVariantId, "source variant id"),
    mistakenStepIndex: integerIndex(record.mistakenStepIndex, "mistaken step index"),
    preErrorSignature: signature(record.preErrorSignature, "pre-error signature"),
    mistakenAfterSignature: signature(record.mistakenAfterSignature, "mistaken after signature"),
    status,
    createdAt: parseTimestamp(record.createdAt, "correction createdAt"),
  };
  if (record.resumeStepCount !== undefined) {
    normalized.resumeStepCount = integerIndex(record.resumeStepCount, "resume step count");
  }
  if (record.correctedStepIndex !== undefined) {
    normalized.correctedStepIndex = integerIndex(record.correctedStepIndex, "corrected step index");
  }
  if (record.derivedVariantId !== undefined) {
    normalized.derivedVariantId = boundedId(record.derivedVariantId, "derived variant id");
  }
  if (record.returnedAt !== undefined) normalized.returnedAt = parseTimestamp(record.returnedAt, "correction returnedAt");
  if (record.correctedAt !== undefined) normalized.correctedAt = parseTimestamp(record.correctedAt, "correction correctedAt");
  if (status !== "RETURN_REQUIRED" && normalized.resumeStepCount === undefined) {
    throw Error("Returned correction requires resume step count");
  }
  if (status === "CORRECTED" && normalized.correctedStepIndex === undefined) {
    throw Error("Corrected correction requires corrected step index");
  }
  return normalized;
}

function correctionEventsForVariant(
  records: TeachingCorrectionRecord[],
  variantId: string,
): TeachingCorrectionRecord[] {
  return records.filter((record) => record.sourceVariantId === variantId);
}

function correctedSteps(
  variant: TeachingVariant,
  records: TeachingCorrectionRecord[],
): TeachingStep[] {
  const events = correctionEventsForVariant(records, variant.id);
  if (events.length === 0) throw Error("No explicit correction provenance exists for this teaching variant");
  if (events.some((event) => event.status !== "CORRECTED")) {
    throw Error("Teaching correction is not complete");
  }
  const superseded = new Set(events.map((event) => event.mistakenStepIndex));
  const steps = variant.steps.filter((_, index) => !superseded.has(index));
  if (steps.length === 0) throw Error("Correction removed every teaching step");
  return steps;
}

export class TeachingCorrectionLedger {
  private data: TeachingCorrectionFile = { version: 1, corrections: [] };
  private persisted: TeachingCorrectionFile = structuredClone(this.data);
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    try {
      const raw = readFileSync(filePath, "utf8");
      if (raw.length > 8 * 1024 * 1024) throw Error("Teaching correction storage limit");
      const parsed = JSON.parse(raw) as { version?: unknown; corrections?: unknown };
      if (parsed.version !== 1 || !Array.isArray(parsed.corrections) || parsed.corrections.length > MAX_CORRECTIONS) {
        throw Error("Invalid teaching correction storage");
      }
      const corrections = parsed.corrections.map(normalizeRecord);
      const ids = new Set(corrections.map((record) => record.id));
      if (ids.size !== corrections.length) throw Error("Duplicate correction id");
      this.data = { version: 1, corrections };
      this.persisted = structuredClone(this.data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  list(): TeachingCorrectionRecord[] {
    return structuredClone(this.data.corrections);
  }

  begin(
    variant: TeachingVariant,
    mistakenStepIndex: number,
    observedAfterSignature: string,
  ): TeachingCorrectionRecord {
    if (variant.status !== "RECORDING") throw Error("Correction requires an active teaching recording");
    if (this.data.corrections.length >= MAX_CORRECTIONS) throw Error("Teaching correction capacity reached");
    if (correctionEventsForVariant(this.data.corrections, variant.id).some((event) => event.status !== "CORRECTED")) {
      throw Error("Finish the current correction before starting another");
    }
    const index = integerIndex(mistakenStepIndex, "mistaken step index");
    if (index !== variant.steps.length - 1) {
      throw Error("Only the most recent demonstrated step can be explicitly corrected");
    }
    if (correctionEventsForVariant(this.data.corrections, variant.id).some((event) => event.mistakenStepIndex === index)) {
      throw Error("Teaching step is already marked as a mistake");
    }
    const step = variant.steps[index];
    if (!step) throw Error("Mistaken teaching step does not exist");
    const observedAfter = signature(observedAfterSignature, "observed after signature");
    if (observedAfter !== step.after) throw Error("Observed state does not match the demonstrated mistake");
    const record: TeachingCorrectionRecord = {
      id: randomUUID(),
      sourceVariantId: variant.id,
      mistakenStepIndex: index,
      preErrorSignature: signature(step.before, "pre-error signature"),
      mistakenAfterSignature: signature(step.after, "mistaken after signature"),
      status: "RETURN_REQUIRED",
      createdAt: new Date().toISOString(),
    };
    this.data.corrections.push(record);
    this.save();
    return structuredClone(record);
  }

  assertLearningAllowed(variantId: string): void {
    const id = boundedId(variantId, "variant id");
    if (correctionEventsForVariant(this.data.corrections, id).some((event) => event.status !== "CORRECTED")) {
      throw Error("Learning is paused until the explicit correction returns to the pre-error state and records a corrected step");
    }
  }

  confirmReturn(
    correctionId: string,
    variant: TeachingVariant,
    observedSignature: string,
  ): TeachingCorrectionRecord {
    if (variant.status !== "RECORDING") throw Error("Correction return requires an active teaching recording");
    const record = this.findMutable(correctionId);
    if (record.sourceVariantId !== variant.id || record.status !== "RETURN_REQUIRED") {
      throw Error("Correction is not waiting for return on this teaching variant");
    }
    const observed = signature(observedSignature, "return signature");
    if (observed !== record.preErrorSignature) {
      throw Error("Return to the recorded pre-error state before learning resumes");
    }
    record.status = "RETURNED";
    record.resumeStepCount = variant.steps.length;
    record.returnedAt = new Date().toISOString();
    this.save();
    return structuredClone(record);
  }

  complete(
    correctionId: string,
    variant: TeachingVariant,
    correctedStepIndex: number,
  ): TeachingCorrectionRecord {
    if (variant.status !== "RECORDING") throw Error("Correction completion requires an active teaching recording");
    const record = this.findMutable(correctionId);
    if (record.sourceVariantId !== variant.id || record.status !== "RETURNED" || record.resumeStepCount === undefined) {
      throw Error("Correction has not safely returned to the pre-error state");
    }
    const index = integerIndex(correctedStepIndex, "corrected step index");
    if (index < record.resumeStepCount) throw Error("Corrected step must be recorded after the safe return");
    const corrected = variant.steps[index];
    if (!corrected) throw Error("Corrected teaching step does not exist");
    if (corrected.before !== record.preErrorSignature) {
      throw Error("Corrected step must begin from the recorded pre-error state");
    }
    record.correctedStepIndex = index;
    record.status = "CORRECTED";
    record.correctedAt = new Date().toISOString();
    this.save();
    return structuredClone(record);
  }

  effectiveSteps(variant: TeachingVariant): TeachingStep[] {
    return structuredClone(correctedSteps(variant, this.data.corrections));
  }

  deriveCorrectedVariant(store: TeachingStore, sourceVariantId: string): TeachingVariant {
    const source = store.get(boundedId(sourceVariantId, "source variant id"));
    if (source.status === "RECORDING") throw Error("Finish the source demonstration before deriving a corrected variant");
    const events = correctionEventsForVariant(this.data.corrections, source.id);
    if (events.length === 0 || events.some((event) => event.status !== "CORRECTED")) {
      throw Error("Only completed explicit corrections can produce a derived teaching variant");
    }
    const existingIds = [...new Set(events.map((event) => event.derivedVariantId).filter((value): value is string => Boolean(value)))];
    if (existingIds.length > 1) throw Error("Correction provenance points at conflicting derived variants");
    if (existingIds.length === 1) return store.get(existingIds[0]);

    const steps = correctedSteps(source, this.data.corrections);
    const sessionId = `correction-derive-${randomUUID()}`;
    const derived = store.start({
      goal: source.goal,
      scope: source.scope,
      profile: source.profile,
      sessionId,
    });
    try {
      for (const step of steps) store.append(derived.id, step);
      const finished = store.finish(derived.id, source.completion, source.finalScreen);
      for (const event of events) event.derivedVariantId = finished.id;
      this.save();
      return finished;
    } catch (error) {
      try {
        if (store.get(derived.id).status === "RECORDING") store.cancel(derived.id);
      } catch {
        // The TeachingStore remains authoritative for its own rollback behavior.
      }
      throw error;
    }
  }

  provenanceForDerived(derivedVariantId: string): {
    sourceVariantId: string;
    correctionIds: string[];
  } | null {
    const id = boundedId(derivedVariantId, "derived variant id");
    const events = this.data.corrections.filter((event) => event.derivedVariantId === id);
    if (events.length === 0) return null;
    const sourceIds = [...new Set(events.map((event) => event.sourceVariantId))];
    if (sourceIds.length !== 1 || events.some((event) => event.status !== "CORRECTED")) {
      throw Error("Invalid correction provenance for derived teaching variant");
    }
    return {
      sourceVariantId: sourceIds[0],
      correctionIds: events.map((event) => event.id).sort(),
    };
  }

  private findMutable(id: string): TeachingCorrectionRecord {
    const correctionId = boundedId(id, "correction id");
    const record = this.data.corrections.find((candidate) => candidate.id === correctionId);
    if (!record) throw Error("Teaching correction not found");
    return record;
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const serialized = JSON.stringify(this.data);
      if (serialized.length > 8 * 1024 * 1024) throw Error("Teaching correction storage limit");
      const temp = `${this.filePath}.tmp`;
      writeFileSync(temp, serialized, { mode: 0o600 });
      renameSync(temp, this.filePath);
      this.persisted = structuredClone(this.data);
    } catch (error) {
      this.data = structuredClone(this.persisted);
      throw error;
    }
  }
}

function recipeDigest(variant: TeachingVariant): string {
  const recipe = variant.steps.map((step) => ({
    action: step.action,
    before: step.before,
    after: step.after,
    gate: step.gate,
    contextKey: step.contextKey,
  }));
  return createHash("sha256").update(JSON.stringify(recipe)).digest("hex");
}

export class TeachingCorrectionLearningEngine {
  private readonly workLearning: VerifiedWorkLearningEngine;

  constructor(workLearning: VerifiedWorkLearningEngine) {
    this.workLearning = workLearning;
  }

  async learnFromVerifiedDerivedReplay(
    store: TeachingStore,
    corrections: TeachingCorrectionLedger,
    derivedVariantId: string,
    verificationRunId: string,
  ): Promise<WorkLearningResult> {
    const variant = store.get(boundedId(derivedVariantId, "derived variant id"));
    const provenance = corrections.provenanceForDerived(variant.id);
    if (!provenance) throw Error("Teaching Skill learning requires explicit correction provenance");
    const runId = boundedId(verificationRunId, "verification run id");
    const run = store.list().runs.find((candidate) => candidate.id === runId);
    if (!run) throw Error("Independent teaching verification run not found");
    if (
      variant.status !== "VERIFIED" ||
      variant.verifiedRunId !== run.id ||
      run.variantId !== variant.id ||
      run.mode !== "verify" ||
      run.status !== "PASSED" ||
      !run.finishedAt ||
      run.deviceId !== variant.profile.deviceId
    ) {
      throw Error("Teaching Skill learning requires a successful independent verified replay");
    }
    if (variant.steps.length === 0 || variant.steps.some((step) => step.gate || step.action.kind === "manual")) {
      throw Error("Unverified or gated teaching steps cannot become a Skill candidate");
    }

    const digest = recipeDigest(variant);
    const evidenceRefs = [
      `teaching-run:${run.id}`,
      `teaching-variant:${variant.id}`,
      `teaching-source:${provenance.sourceVariantId}`,
      ...provenance.correctionIds.map((id) => `teaching-correction:${id}`),
    ];
    return this.workLearning.learn({
      goalId: `teaching:${variant.id}`,
      goalSummary: variant.goal,
      capability: "teaching.replay",
      applicability: [variant.goal, `platform:${variant.profile.platform}`, `app:${variant.profile.app}`],
      plan: [`Replay corrected teaching variant ${variant.id} under existing authorization and device gates`],
      attempts: [
        {
          id: `verify:${run.id}`,
          strategyId: `corrected-teaching:${provenance.sourceVariantId}`,
          procedure: `teaching-variant:${variant.id}@sha256:${digest}`,
          resultOk: true,
          verifierPassed: true,
          evidenceRefs,
        },
      ],
      outcome: "COMPLETED",
      completedAt: run.finishedAt,
      constraints: {
        capabilities: ["teaching-replay"],
        executionModes: ["verified-teaching"],
        connectivity: "either",
        maxRisk: "low",
      },
    });
  }
}
