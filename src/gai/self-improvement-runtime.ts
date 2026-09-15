import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ImprovementSurface = "prompt" | "planner" | "router" | "recovery" | "skill" | "code" | "config";
export type ImprovementState = "candidate" | "rejected" | "awaiting-device-e2e" | "canary" | "promoted" | "rolled-back";

export interface ImprovementCandidate {
  id: string;
  surface: ImprovementSurface;
  sourceEvidence: string[];
  knownGoodVersion: string;
  candidateVersion: string;
  verified: boolean;
  measurableGain: number;
  safetyRegression: boolean;
  humanInterventionDelta: number;
  additionalApiCostUsd: number;
  weakensHumanGate?: boolean;
  weakensRiskCeiling?: boolean;
  weakensCredentialBoundary?: boolean;
}

export interface ImprovementStageResult { ok: boolean; evidence: string[]; reason?: string }
export interface ImprovementAdapters {
  sandbox(candidate: ImprovementCandidate): Promise<ImprovementStageResult>;
  test(candidate: ImprovementCandidate): Promise<ImprovementStageResult>;
  regression(candidate: ImprovementCandidate): Promise<ImprovementStageResult>;
  deviceE2E(candidate: ImprovementCandidate): Promise<ImprovementStageResult>;
  canary(candidate: ImprovementCandidate): Promise<ImprovementStageResult>;
  promote(candidate: ImprovementCandidate): Promise<ImprovementStageResult>;
  rollback(candidate: ImprovementCandidate): Promise<ImprovementStageResult>;
}

export interface ImprovementRecord {
  candidateId: string;
  surface: ImprovementSurface;
  candidateVersion: string;
  knownGoodVersion: string;
  state: ImprovementState;
  evidence: string[];
  reason?: string;
  updatedAt: string;
}

interface LedgerFile { version: 1; records: ImprovementRecord[] }

export class SelfImprovementRuntime {
  #records: ImprovementRecord[] = [];
  #loaded = false;
  private readonly filePath: string;
  private readonly adapters: ImprovementAdapters;

  constructor(filePath: string, adapters: ImprovementAdapters) {
    this.filePath = filePath;
    this.adapters = adapters;
  }

  async run(candidate: ImprovementCandidate): Promise<ImprovementRecord> {
    await this.#ensureLoaded();
    const invariantFailure = this.#invariantFailure(candidate);
    if (invariantFailure) return this.#save(candidate, "rejected", [], invariantFailure);

    const evidence = [...candidate.sourceEvidence];
    for (const [name, stage] of [
      ["sandbox", this.adapters.sandbox],
      ["tests", this.adapters.test],
      ["regression", this.adapters.regression],
    ] as const) {
      const result = await stage(candidate);
      evidence.push(...result.evidence);
      if (!result.ok) return this.#save(candidate, "rejected", evidence, result.reason ?? `${name}_failed`);
    }

    const device = await this.adapters.deviceE2E(candidate);
    evidence.push(...device.evidence);
    if (!device.ok) return this.#save(candidate, "awaiting-device-e2e", evidence, device.reason ?? "real_device_e2e_required");

    const canary = await this.adapters.canary(candidate);
    evidence.push(...canary.evidence);
    if (!canary.ok) {
      const rollback = await this.adapters.rollback(candidate);
      evidence.push(...rollback.evidence);
      return this.#save(candidate, "rolled-back", evidence, canary.reason ?? "canary_regression");
    }

    await this.#save(candidate, "canary", evidence);
    const promotion = await this.adapters.promote(candidate);
    evidence.push(...promotion.evidence);
    if (!promotion.ok) {
      const rollback = await this.adapters.rollback(candidate);
      evidence.push(...rollback.evidence);
      return this.#save(candidate, "rolled-back", evidence, promotion.reason ?? "promotion_failed");
    }
    return this.#save(candidate, "promoted", evidence);
  }

  async list(): Promise<ImprovementRecord[]> { await this.#ensureLoaded(); return [...this.#records]; }

  #invariantFailure(candidate: ImprovementCandidate): string | undefined {
    if (!candidate.verified || candidate.sourceEvidence.length === 0) return "verified_evidence_required";
    if (!candidate.knownGoodVersion || !candidate.candidateVersion) return "rollback_target_required";
    if (candidate.weakensHumanGate || candidate.weakensRiskCeiling || candidate.weakensCredentialBoundary) return "governance_weakening_forbidden";
    if (candidate.additionalApiCostUsd > 0) return "zero_additional_api_cost_required";
    if (candidate.safetyRegression) return "safety_regression";
    if (candidate.humanInterventionDelta > 0) return "human_intervention_regressed";
    if (candidate.measurableGain <= 0) return "measurable_gain_required";
    return undefined;
  }

  async #save(candidate: ImprovementCandidate, state: ImprovementState, evidence: string[], reason?: string): Promise<ImprovementRecord> {
    const record: ImprovementRecord = { candidateId: candidate.id, surface: candidate.surface, candidateVersion: candidate.candidateVersion, knownGoodVersion: candidate.knownGoodVersion, state, evidence: [...evidence], reason, updatedAt: new Date().toISOString() };
    this.#records = this.#records.filter((item) => item.candidateId !== candidate.id);
    this.#records.push(record);
    await this.#persist();
    return record;
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    try { const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as LedgerFile; this.#records = parsed.records ?? []; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.#loaded = true;
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, records: this.#records }, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
