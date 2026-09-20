import type { GoalControllerRuntime, UnifiedIntakeRequest } from "./goal-controller-runtime.ts";
import { ContextResolver, contextRecordFromIntake, type SharedContextStore } from "./shared-context.ts";

export class UnifiedEntryRuntime {
  private readonly controller: GoalControllerRuntime;
  private readonly contextStore?: SharedContextStore;
  private readonly contextResolver?: ContextResolver;

  constructor(input: { controller: GoalControllerRuntime; contextStore?: SharedContextStore }) {
    this.controller = input.controller;
    this.contextStore = input.contextStore;
    this.contextResolver = input.contextStore ? new ContextResolver(input.contextStore) : undefined;
  }

  async handle(request: UnifiedIntakeRequest) {
    const decision = await this.controller.handle(request);
    const intake = decision.resolution.intake;
    const goalId = decision.goalId ?? decision.resolution.goal?.goalId;
    const context = this.contextResolver ? await this.contextResolver.resolve({ intake, goalId }) : [];
    if (this.contextStore) {
      await this.contextStore.put(contextRecordFromIntake(intake, decision.resolution.intent, {
        goalId,
        summary: intake.text,
        result: { resolution: decision.resolution.kind, action: decision.action },
      }));
    }
    return { decision, context };
  }
}
