import { assessResearchProgram, getResearchStage, nextExecutableResearchStages, type ResearchEvidence, type ResearchStageId } from "./research-ops-program.ts";

export type CampaignExecutionMode = "local-safe" | "local-model" | "external-runtime" | "human-review";

export interface ResearchCampaignPlanItem {
  stage: ResearchStageId;
  mode: CampaignExecutionMode;
  runnableAutomatically: boolean;
  reason: string;
  suggestedCommand?: string;
  requiredExternalEvidence?: boolean;
}

const stageModes: Record<ResearchStageId, CampaignExecutionMode> = {
  R1: "local-model",
  R2: "local-model",
  R3: "external-runtime",
  R4: "local-model",
  R5: "human-review",
  R6: "local-model",
  R7: "local-safe",
  R8: "local-model",
  R9: "local-safe",
  R10: "local-safe",
  R11: "local-model",
  R12: "external-runtime",
  R13: "local-model",
  R14: "local-safe",
  R15: "local-safe",
  R16: "local-model",
  R17: "human-review",
  R18: "local-model",
  R19: "external-runtime",
  R20: "human-review",
};

const commands: Partial<Record<ResearchStageId, string>> = {
  R1: "node scripts/gai-baseline.mjs --real --resume",
  R6: "node scripts/gai-baseline-v11.mjs --real --resume",
  R7: "node scripts/research-program-status.ts --require-evidence",
};

const automaticModes = new Set<CampaignExecutionMode>(["local-safe", "local-model"]);
const humanRequiredStages = new Set<ResearchStageId>(["R5", "R17", "R20"]);

export function planResearchCampaign(evidence: readonly ResearchEvidence[]): ResearchCampaignPlanItem[] {
  const ready = nextExecutableResearchStages(evidence);
  return ready.map((stage) => {
    const definition = getResearchStage(stage);
    const mode = stageModes[stage];
    const external = definition.externalValidationRequired || mode === "external-runtime";
    const humanReview = humanRequiredStages.has(stage) || mode === "human-review";
    const runnableAutomatically = automaticModes.has(mode) && !external && !humanReview;
    return {
      stage,
      mode,
      runnableAutomatically,
      reason: humanReview
        ? "stage requires explicit human/independent review before completion"
        : external
          ? "stage requires real external runtime or independent evidence"
          : "dependencies are complete and required local evidence can be generated inside the bounded research runtime",
      suggestedCommand: commands[stage],
      requiredExternalEvidence: external,
    };
  });
}

export interface ResearchProgramSnapshot {
  completed: ResearchStageId[];
  ready: ResearchStageId[];
  blocked: ResearchStageId[];
  automaticQueue: ResearchCampaignPlanItem[];
  externalQueue: ResearchCampaignPlanItem[];
  humanQueue: ResearchCampaignPlanItem[];
}

export function summarizeResearchProgram(evidence: readonly ResearchEvidence[]): ResearchProgramSnapshot {
  const assessments = assessResearchProgram(evidence);
  const plan = planResearchCampaign(evidence);
  return {
    completed: assessments.filter((item) => item.status === "complete").map((item) => item.stage),
    ready: assessments.filter((item) => item.status === "ready").map((item) => item.stage),
    blocked: assessments.filter((item) => item.status === "blocked").map((item) => item.stage),
    automaticQueue: plan.filter((item) => item.runnableAutomatically),
    externalQueue: plan.filter((item) => item.mode === "external-runtime"),
    humanQueue: plan.filter((item) => item.mode === "human-review"),
  };
}
