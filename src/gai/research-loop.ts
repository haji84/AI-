import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { BenchmarkOutcomeRecord } from "./benchmark-history.ts";

export type Bottleneck = "memory" | "planner" | "world-model" | "skill" | "tooling" | "model-reasoning";

export interface FailureSignal {
  taskId: string;
  actionId: string;
  bottleneck: Bottleneck;
  severity: number;
  evidence: string[];
}

export interface ResearchHypothesis {
  id: string;
  bottleneck: Bottleneck;
  statement: string;
  expectedGain: number;
  evidenceCount: number;
  status: "proposed" | "testing" | "accepted" | "rejected";
}

export interface ResearchExperiment {
  id: string;
  hypothesisId: string;
  benchmarkBefore: number;
  benchmarkAfter: number;
  humanInterventionBefore: number;
  humanInterventionAfter: number;
  additionalApiCost: number;
  safetyRegression: boolean;
  createdAt: string;
  decision: "accepted" | "rejected";
  reason: string;
}

interface ResearchFile {
  version: 1;
  hypotheses: ResearchHypothesis[];
  experiments: ResearchExperiment[];
}

function inferBottleneck(record: BenchmarkOutcomeRecord): Bottleneck {
  const text = `${record.taskId} ${record.actionId}`.toLowerCase();
  if (text.includes("memory") || text.includes("retrieve")) return "memory";
  if (text.includes("plan") || text.includes("route")) return "planner";
  if (text.includes("world") || text.includes("predict")) return "world-model";
  if (text.includes("skill")) return "skill";
  if (text.includes("tool") || text.includes("capability")) return "tooling";
  return "model-reasoning";
}

export function clusterFailures(records: BenchmarkOutcomeRecord[]): FailureSignal[] {
  return records
    .filter((record) => !record.passed)
    .map((record) => ({
      taskId: record.taskId,
      actionId: record.actionId,
      bottleneck: inferBottleneck(record),
      severity: Math.min(1, 0.5 + record.humanInterventionCount * 0.1),
      evidence: [`failed attempt ${record.attempt}`, `durationMs=${record.durationMs}`],
    }));
}

export function proposeResearchHypotheses(signals: FailureSignal[]): ResearchHypothesis[] {
  const grouped = new Map<Bottleneck, FailureSignal[]>();
  for (const signal of signals) {
    const list = grouped.get(signal.bottleneck) ?? [];
    list.push(signal);
    grouped.set(signal.bottleneck, list);
  }
  return [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([bottleneck, items]) => ({
      id: `hypothesis:${bottleneck}`,
      bottleneck,
      statement: `Improve ${bottleneck} behavior to reduce recurring verified task failures.`,
      expectedGain: Math.min(0.25, 0.02 * items.length),
      evidenceCount: items.length,
      status: "proposed" as const,
    }));
}

export function decideExperiment(input: Omit<ResearchExperiment, "createdAt" | "decision" | "reason">, minimumGain = 0.01): ResearchExperiment {
  const gain = input.benchmarkAfter - input.benchmarkBefore;
  const interventionRegression = input.humanInterventionAfter > input.humanInterventionBefore;
  let decision: ResearchExperiment["decision"] = "accepted";
  let reason = `Held-out benchmark improved by ${gain.toFixed(4)} without safety, cost, or intervention regression.`;
  if (input.additionalApiCost !== 0) {
    decision = "rejected";
    reason = "Rejected because additional pay-as-you-go AI API cost was non-zero.";
  } else if (input.safetyRegression) {
    decision = "rejected";
    reason = "Rejected because the candidate regressed safety.";
  } else if (interventionRegression) {
    decision = "rejected";
    reason = "Rejected because human-intervention rate regressed.";
  } else if (gain < minimumGain) {
    decision = "rejected";
    reason = `Rejected because held-out gain ${gain.toFixed(4)} is below ${minimumGain.toFixed(4)}.`;
  }
  return { ...input, createdAt: new Date().toISOString(), decision, reason };
}

export class PersistentResearchHistory {
  #hypotheses = new Map<string, ResearchHypothesis>();
  #experiments: ResearchExperiment[] = [];
  #loaded = false;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as ResearchFile;
      for (const hypothesis of parsed.hypotheses ?? []) this.#hypotheses.set(hypothesis.id, hypothesis);
      this.#experiments = parsed.experiments ?? [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.#loaded = true;
  }

  async saveHypothesis(hypothesis: ResearchHypothesis): Promise<void> {
    await this.#ensureLoaded();
    this.#hypotheses.set(hypothesis.id, hypothesis);
    await this.#persist();
  }

  async recordExperiment(experiment: ResearchExperiment): Promise<void> {
    await this.#ensureLoaded();
    this.#experiments = this.#experiments.filter((item) => item.id !== experiment.id);
    this.#experiments.push(experiment);
    const hypothesis = this.#hypotheses.get(experiment.hypothesisId);
    if (hypothesis) this.#hypotheses.set(hypothesis.id, { ...hypothesis, status: experiment.decision });
    await this.#persist();
  }

  async listExperiments(): Promise<ResearchExperiment[]> {
    await this.#ensureLoaded();
    return [...this.#experiments];
  }

  async listHypotheses(): Promise<ResearchHypothesis[]> {
    await this.#ensureLoaded();
    return [...this.#hypotheses.values()];
  }

  async #ensureLoaded(): Promise<void> {
    if (!this.#loaded) await this.load();
  }

  async #persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    const payload: ResearchFile = { version: 1, hypotheses: [...this.#hypotheses.values()], experiments: this.#experiments };
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
