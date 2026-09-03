import type { ModelPlan, PlanningModel } from "./model-planner.ts";

export interface WorkCodexPlanEnvelope {
  source: "work-codex";
  plan: ModelPlan;
}

function validatePlan(value: unknown): ModelPlan {
  if (!value || typeof value !== "object") throw new Error("Work/Codex handoff plan is missing or invalid");
  const parsed = value as ModelPlan;
  if (!["local_blocker", "propose_pr", "inspect"].includes(parsed.kind) || !parsed.description?.trim()) {
    throw new Error("Work/Codex handoff plan is invalid");
  }
  if (parsed.kind === "propose_pr") {
    if (!parsed.title?.trim() || !Array.isArray(parsed.files) || parsed.files.length < 1 || parsed.files.length > 3) {
      throw new Error("Work/Codex propose_pr must contain a title and 1-3 files");
    }
    for (const file of parsed.files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
        throw new Error("Work/Codex propose_pr files must contain path and content");
      }
    }
  }
  return parsed;
}

export class WorkCodexPlanningClient implements PlanningModel {
  private readonly envelopeJson: string;

  constructor(envelopeJson = process.env.AUTONOMY_WORK_CODEX_PLAN_JSON?.trim() || "") {
    this.envelopeJson = envelopeJson;
  }

  async plan(): Promise<ModelPlan> {
    if (!this.envelopeJson) {
      throw new Error(
        "Work/Codex planning handoff is required. GitHub Actions is an execution/verification host and must not substitute a model provider.",
      );
    }

    let envelope: WorkCodexPlanEnvelope;
    try {
      envelope = JSON.parse(this.envelopeJson) as WorkCodexPlanEnvelope;
    } catch {
      throw new Error("Work/Codex planning handoff is not valid JSON");
    }

    if (envelope?.source !== "work-codex") {
      throw new Error("Work/Codex planning handoff must declare source=work-codex");
    }
    return validatePlan(envelope.plan);
  }
}
