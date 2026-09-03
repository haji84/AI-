import type { ModelPlan, PlanningModel } from "./model-planner.ts";
import { parseUnifiedCommandEnvelope, type NormalizedCommand } from "./command-ingress.ts";

function validatePlan(value: unknown): ModelPlan {
  if (!value || typeof value !== "object") throw new Error("Chat/Work/Codex plan is missing or invalid");
  const parsed = value as ModelPlan;
  if (!["local_blocker", "propose_pr", "inspect"].includes(parsed.kind) || !parsed.description?.trim()) {
    throw new Error("Chat/Work/Codex plan is invalid");
  }
  if (parsed.kind === "propose_pr") {
    if (!parsed.title?.trim() || !Array.isArray(parsed.files) || parsed.files.length < 1 || parsed.files.length > 3) {
      throw new Error("Chat/Work/Codex propose_pr must contain a title and 1-3 files");
    }
    for (const file of parsed.files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
        throw new Error("Chat/Work/Codex propose_pr files must contain path and content");
      }
    }
  }
  return parsed;
}

export class UnifiedPlanningClient implements PlanningModel {
  readonly command: NormalizedCommand;

  constructor(envelopeJson = process.env.AUTONOMY_COMMAND_JSON?.trim() || "") {
    this.command = parseUnifiedCommandEnvelope(envelopeJson);
  }

  async plan(): Promise<ModelPlan> {
    if (!this.command.plan) {
      throw new Error(
        `Chat/Work/Codex planning handoff from ${this.command.source} requires an explicit bounded plan. GitHub Actions must not substitute a model provider.`,
      );
    }
    return validatePlan(this.command.plan);
  }
}
