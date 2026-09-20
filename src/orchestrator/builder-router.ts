import type { ProposedAction, ActionResult, ContextItem } from "./goal-loop.ts";

export interface BuilderRequest {
  goalId: string;
  attemptId: string;
  strategyId: string;
  objective: string;
  files?: string[];
  context: ContextItem[];
  previousFailureSignatures?: string[];
}

export interface BuilderCapability {
  id: string;
  available(): Promise<boolean>;
  build(request: BuilderRequest): Promise<ActionResult>;
}

export class BuilderRouter {
  private readonly builders: BuilderCapability[];
  constructor(builders: BuilderCapability[]) { this.builders = builders; }

  async execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult> {
    const input = action.input as Partial<BuilderRequest> | undefined;
    if (!input?.goalId || !input.attemptId || !input.strategyId) {
      return { actionId: action.id, ok: false, summary: "Builder contract is incomplete", blocker: "builder_contract_incomplete" };
    }
    for (const builder of this.builders) {
      if (await builder.available()) {
        const result = await builder.build({
          goalId: input.goalId,
          attemptId: input.attemptId,
          strategyId: input.strategyId,
          objective: input.objective ?? action.description,
          files: input.files,
          context,
          previousFailureSignatures: input.previousFailureSignatures,
        });
        return { ...result, actionId: action.id };
      }
    }
    return {
      actionId: action.id,
      ok: false,
      summary: "No real Builder capability is currently available",
      blocker: "real_builder_capability_unavailable",
      evidence: { requestedCapability: action.capability, candidateCount: this.builders.length },
    };
  }
}
