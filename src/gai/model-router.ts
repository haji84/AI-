import type { ModelRoute, TaskProfile } from "./types.ts";

/**
 * Routes work without permitting pay-as-you-go AI API usage.
 * The caller is responsible for mapping `sol` and `astra` to capabilities
 * already available inside the user's ChatGPT plan/runtime.
 */
export function routeModel(task: TaskProfile): ModelRoute {
  if (task.risk === "CRITICAL") {
    return {
      tier: "local",
      reason: "CRITICAL work must not be delegated to an autonomous paid/frontier execution path.",
      fallback: [],
      additionalApiCostAllowed: false,
    };
  }

  if (task.requiresFrontierReasoning || task.difficulty >= 9) {
    return {
      tier: "astra",
      reason: "Reserve the strongest available plan-included model for frontier reasoning and research-critical work.",
      fallback: ["sol", "local"],
      additionalApiCostAllowed: false,
    };
  }

  if (task.difficulty >= 5 || task.requiresLongContext) {
    return {
      tier: "sol",
      reason: "Use the main reasoning model for medium/high difficulty work while preserving Astra capacity.",
      fallback: ["local"],
      additionalApiCostAllowed: false,
    };
  }

  return {
    tier: "local",
    reason: "Routine work should stay local to preserve frontier-model quota and keep incremental AI API cost at zero.",
    fallback: [],
    additionalApiCostAllowed: false,
  };
}
