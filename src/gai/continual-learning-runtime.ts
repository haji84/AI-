import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type LearningDecision = "promote" | "reject" | "rollback" | "record-only";

export interface ContinualLearningCandidate {
  id: string;
  sourceOutcomeIds: string[];
  verified: boolean;
  split: "train" | "heldout";
  humanRejected?: boolean;
  baselinePassRate: number;
  candidatePassRate: number;
  transferDelta: number;
  forgettingDelta: number;
  safetyRegression: boolean;
  humanInterventionDelta: number;
  additionalApiCostUsd: number;
  weakensHumanGate?: boolean;
  weakensRiskCeiling?: boolean;
}

export interface ContinualLearningRecord {
  candidateId: string;
  decision: LearningDecision;
  reasons: string[];
  provenance: string[];
  createdAt: string;
}

interface LearningLedgerFile { version: 1; records: ContinualLearningRecord[] }

export class ContinualLearningRuntime {
  #records: ContinualLearningRecord[] = [];
  #loaded = false;
  private readonly filePath: string;

  constructor(filePath: string) { this.filePath = filePath; }

  async evaluate(candidate: ContinualLearningCandidate): Promise<ContinualLearningRecord> {
    await this.#ensureLoaded();
    const reasons: string[] = [];
    let decision: LearningDecision = "promote";

    if (!candidate.verified || candidate.sourceOutcomeIds.length === 0) {
      decision = "reject"; reasons.push("verified_evidence_required");
    } else if (candidate.humanRejected) {
      decision = "reject"; reasons.push("human_rejected");
    } else if (candidate.split === "heldout") {
      decision = "record-only"; reasons.push("heldout_must_not_train");
    } else if (candidate.weakensHumanGate || candidate.weakensRiskCeiling) {
      decision = "reject"; reasons.push("governance_weakening_forbidden");
    } else if (candidate.safetyRegression) {
      decision = "rollback"; reasons.push("safety_regression");
    } else if (candidate.candidatePassRate < candidate.baselinePassRate) {
      decision = "rollback"; reasons.push("heldout_or_regression_loss");
    } else if (candidate.forgettingDelta > 0) {
      decision = "rollback"; reasons.push("catastrophic_forgetting_detected");
    } else if (candidate.additionalApiCostUsd > 0) {
      decision = "reject"; reasons.push("zero_additional_api_cost_required");
    } else if (candidate.humanInterventionDelta > 0) {
      decision = "reject"; reasons.push("human_intervention_regressed");
    } else if (candidate.transferDelta < 0) {
      decision = "reject"; reasons.push("transfer_regressed");
    } else if (candidate.candidatePassRate === candidate.baselinePassRate && candidate.transferDelta === 0) {
      decision = "reject"; reasons.push("no_measurable_gain");
    } else {
      reasons.push("verified_measurable_gain_without_regression");
    }

    const record: ContinualLearningRecord = {
      candidateId: candidate.id,
      decision,
      reasons,
      provenance: [...candidate.sourceOutcomeIds],
      createdAt: new Date().toISOString(),
    };
    this.#records = this.#records.filter((item) => item.candidateId !== candidate.id);
    this.#records.push(record);
    await this.#persist();
    return record;
  }

  async list(): Promise<ContinualLearningRecord[]> {
    await this.#ensureLoaded();
    return [...this.#records];
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as LearningLedgerFile;
      this.#records = parsed.records ?? [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, records: this.#records }, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
