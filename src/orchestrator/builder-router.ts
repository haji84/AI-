import type { ProposedAction, ActionResult, ContextItem } from "./goal-loop.ts";
import { developmentStrategyFingerprint, type DevelopmentBuilderKind } from "./development-builder.ts";

export interface BuilderRequest {
  goalId: string;
  attemptId: string;
  strategyId: string;
  objective: string;
  files?: string[];
  context: ContextItem[];
  previousFailureSignatures?: string[];
  previousStrategyFingerprints?: string[];
  hypothesis?: string;
  baseRevision?: string;
  localOnly?: boolean;
}

export interface BuilderCapability {
  id: string;
  kind?: DevelopmentBuilderKind;
  available(): Promise<boolean>;
  build(request: BuilderRequest): Promise<ActionResult>;
}

function isVerifierOnlyContext(item: ContextItem): boolean {
  if (item.source === "development.verification_contract") return true;
  if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) return false;
  return (item.data as { source?: unknown }).source === "development.verification_contract";
}

export class BuilderRouter {
  private readonly builders: BuilderCapability[];
  constructor(builders: BuilderCapability[]) { this.builders = builders; }

  async execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult> {
    const input = action.input as Partial<BuilderRequest> | undefined;
    if (!input?.goalId || !input.attemptId || !input.strategyId) {
      return { actionId: action.id, ok: false, summary: "Builder contract is incomplete", blocker: "builder_contract_incomplete" };
    }
    const request: BuilderRequest = {
      goalId: input.goalId,
      attemptId: input.attemptId,
      strategyId: input.strategyId,
      objective: input.objective ?? action.description,
      files: input.files,
      context: context.filter((item) => !isVerifierOnlyContext(item)),
      previousFailureSignatures: input.previousFailureSignatures,
      previousStrategyFingerprints: input.previousStrategyFingerprints,
      hypothesis: input.hypothesis,
      baseRevision: input.baseRevision,
      localOnly: input.localOnly,
    };
    const fingerprint = developmentStrategyFingerprint(request);
    if (request.previousStrategyFingerprints?.includes(fingerprint)) {
      return {
        actionId: action.id,
        ok: false,
        summary: "Materially equivalent failed Builder strategy requires a changed hypothesis or evidence",
        blocker: "equivalent_failed_strategy",
        evidence: { strategyFingerprint: fingerprint },
      };
    }
    let lastUnavailable: ActionResult | null = null;
    for (const builder of this.builders) {
      if (request.localOnly && builder.kind !== "local") continue;
      if (await builder.available()) {
        const result = await builder.build(request);
        if (result.ok) return { ...result, actionId: action.id };
        if (["http_code_builder_unreachable", "worker_code_builder_unavailable", "local_builder_unavailable"].includes(result.blocker ?? "")) {
          lastUnavailable = { ...result, actionId: action.id };
          continue;
        }
        return { ...result, actionId: action.id };
      }
    }
    if (lastUnavailable) return lastUnavailable;
    return {
      actionId: action.id,
      ok: false,
      summary: "No real Builder capability is currently available",
      blocker: "real_builder_capability_unavailable",
      evidence: { requestedCapability: action.capability, candidateCount: this.builders.length },
    };
  }
}
