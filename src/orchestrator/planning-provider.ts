import { CopilotCliPlanningClient } from "./copilot-cli-planner.ts";
import { GitHubModelsPlanningClient, type ModelPlan, type PlanningModel } from "./model-planner.ts";

export type AutonomyPlannerProvider = "work-cloud" | "copilot-cli" | "github-models";

export class WorkCloudPlanningClient implements PlanningModel {
  async plan(): Promise<ModelPlan> {
    return {
      kind: "inspect",
      description: "Planning is delegated to ChatGPT Work cloud. This GitHub-hosted runner will not invoke a paid or separately metered model provider by default.",
      reason: "work_cloud_external_planner",
    };
  }
}

export function createPlanningModel(options: {
  provider?: string;
  token?: string;
} = {}): PlanningModel {
  const provider = (options.provider?.trim() || process.env.AUTONOMY_PLANNER_PROVIDER?.trim() || "work-cloud") as AutonomyPlannerProvider;
  const token = options.token ?? process.env.GITHUB_TOKEN?.trim() ?? "";

  if (provider === "work-cloud") return new WorkCloudPlanningClient();
  if (provider === "copilot-cli") return new CopilotCliPlanningClient();
  if (provider === "github-models") return new GitHubModelsPlanningClient(token);
  throw new Error(`unsupported autonomy planner provider: ${provider}`);
}
