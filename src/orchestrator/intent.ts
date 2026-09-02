import type { ContextItem, Goal, InferredIntent, IntentEvidence } from "./goal-loop.ts";

export function inferIntentFromSignals(input: {
  goal: Goal;
  context?: ContextItem[];
  preferences?: string[];
  recentDecisions?: string[];
}): InferredIntent {
  const evidence: IntentEvidence[] = [];

  evidence.push({ source: "goal", text: input.goal.title });
  for (const constraint of input.goal.constraints) evidence.push({ source: "constraint", text: constraint });
  for (const preference of input.preferences ?? []) evidence.push({ source: "preference", text: preference });
  for (const decision of input.recentDecisions ?? []) evidence.push({ source: "recent_decision", text: decision });
  for (const item of input.context ?? []) evidence.push({ source: "context", text: `${item.source}: ${item.summary}` });

  const explicitSignals = 1 + input.goal.constraints.length + (input.preferences?.length ?? 0) + (input.recentDecisions?.length ?? 0);
  const confidence = Math.min(0.98, 0.55 + Math.min(explicitSignals, 8) * 0.05);

  const preferenceText = input.preferences?.length ? ` Preferences: ${input.preferences.join("; ")}.` : "";
  const decisionText = input.recentDecisions?.length ? ` Recent decisions: ${input.recentDecisions.join("; ")}.` : "";

  return {
    summary: `Likely intent: advance the explicit goal “${input.goal.title}” while preserving stated constraints.${preferenceText}${decisionText}`,
    confidence,
    evidence,
  };
}
