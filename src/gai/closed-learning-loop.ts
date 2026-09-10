import type { Observation, Prediction } from "./types.ts";
import { PersistentBenchmarkHistory, type BenchmarkSplit } from "./benchmark-history.ts";
import { PersistentMemoryStore } from "./memory-store.ts";
import { PersistentSkillLibrary } from "./skill-library.ts";
import { PersistentWorldModel } from "./world-model.ts";

export interface ClosedLoopInput {
  id: string;
  taskId: string;
  task: string;
  attempt: number;
  split: BenchmarkSplit;
  actionId: string;
  prediction: Prediction;
  actualOutcome: string;
  success: boolean;
  evidence: string[];
  verificationPassed: boolean;
  humanRejected?: boolean;
  humanInterventionCount: number;
  durationMs: number;
  transferTask?: boolean;
  selectedSkillId?: string;
}

export interface ClosedLoopResult {
  accepted: boolean;
  trainingApplied: boolean;
  reason: "accepted" | "unverified" | "human_rejected" | "heldout_recorded_only";
  benchmarkRecorded: boolean;
  worldModelRecorded: boolean;
  skillUpdated: boolean;
}

export class ClosedLearningLoop {
  private readonly benchmark: PersistentBenchmarkHistory;
  private readonly memory: PersistentMemoryStore;
  private readonly world: PersistentWorldModel;
  private readonly skills: PersistentSkillLibrary;

  constructor(input: {
    benchmark: PersistentBenchmarkHistory;
    memory: PersistentMemoryStore;
    world: PersistentWorldModel;
    skills: PersistentSkillLibrary;
  }) {
    this.benchmark = input.benchmark;
    this.memory = input.memory;
    this.world = input.world;
    this.skills = input.skills;
  }

  async process(input: ClosedLoopInput): Promise<ClosedLoopResult> {
    if (input.humanRejected) {
      return {
        accepted: false,
        trainingApplied: false,
        reason: "human_rejected",
        benchmarkRecorded: false,
        worldModelRecorded: false,
        skillUpdated: false,
      };
    }
    if (!input.verificationPassed || input.evidence.length === 0) {
      return {
        accepted: false,
        trainingApplied: false,
        reason: "unverified",
        benchmarkRecorded: false,
        worldModelRecorded: false,
        skillUpdated: false,
      };
    }

    await this.benchmark.record({
      id: input.id,
      taskId: input.taskId,
      attempt: input.attempt,
      split: input.split,
      verified: true,
      actionId: input.actionId,
      selectedSkillId: input.selectedSkillId,
      passed: input.success,
      humanInterventionCount: input.humanInterventionCount,
      durationMs: input.durationMs,
      transferTask: input.transferTask,
    });

    if (input.split === "heldout") {
      return {
        accepted: true,
        trainingApplied: false,
        reason: "heldout_recorded_only",
        benchmarkRecorded: true,
        worldModelRecorded: false,
        skillUpdated: false,
      };
    }

    const observation: Observation = {
      actualOutcome: input.actualOutcome,
      success: input.success,
      evidence: input.evidence,
    };
    await this.world.record({
      id: input.id,
      context: input.task,
      prediction: input.prediction,
      observation,
    });

    let skillUpdated = false;
    if (input.selectedSkillId) {
      skillUpdated = Boolean(await this.skills.recordOutcome(input.selectedSkillId, input.success));
    }

    // The world model owns the verified handoff into episodic/semantic/procedural memory.
    // Keeping memory here as an explicit dependency makes the closed-loop boundary auditable.
    void this.memory;

    return {
      accepted: true,
      trainingApplied: true,
      reason: "accepted",
      benchmarkRecorded: true,
      worldModelRecorded: true,
      skillUpdated,
    };
  }
}
