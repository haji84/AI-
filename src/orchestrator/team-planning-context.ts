import type { ContextItem } from "./goal-loop.ts";
import { composeTeamFromIssue, type EmployeeRole, type TeamComposition } from "./team-composer.ts";
import {
  BoundedTeamExecutionCoordinator,
  type EmployeeWorkInput,
  type EmployeeWorkResult,
  type EmployeeWorker,
  type TeamExecutionReport,
} from "./team-execution.ts";

export type TeamPlanningBundle = {
  issue: { number?: number; title: string; body?: string | null; url?: string };
  team: TeamComposition;
  execution: TeamExecutionReport;
  context: ContextItem;
};

function roleReasons(team: TeamComposition, role: EmployeeRole): string[] {
  return team.members.find((member) => member.role === role)?.reasons ?? [];
}

export class PlanningEmployeeWorker implements EmployeeWorker {
  async run(input: EmployeeWorkInput): Promise<EmployeeWorkResult> {
    const reasons = roleReasons(input.team, input.role);
    const prior = input.priorResults.map((result) => result.role).join(" -> ") || "none";

    if (input.role === "Governor" && input.team.humanGateSignals.length > 0) {
      return {
        ok: true,
        requiresApproval: true,
        summary: `Governor identified Human Gate signals before production work: ${input.team.humanGateSignals.join(", ")}.`,
      };
    }

    if (input.role === "PM") {
      return {
        ok: true,
        summary: `PM scoped the issue and coordinated the selected team: ${input.team.members.map((member) => member.role).join(", ")}.`,
      };
    }

    if (input.role === "QA") {
      return {
        ok: true,
        summary: `QA prepared verification focus for the requested change after prior roles: ${prior}.`,
      };
    }

    if (input.role === "Reviewer") {
      return {
        ok: true,
        summary: `Reviewer prepared an independent review checkpoint after prior roles: ${prior}.`,
      };
    }

    return {
      ok: true,
      summary: `${input.role} contributes a bounded planning handoff for signals: ${reasons.join(", ") || "selected role evidence"}. Prior roles: ${prior}.`,
    };
  }
}

export async function buildTeamPlanningBundle(input: {
  issue: { number?: number; title: string; body?: string | null; url?: string };
  worker?: EmployeeWorker;
  maxRoles?: number;
}): Promise<TeamPlanningBundle> {
  const team = composeTeamFromIssue({ title: input.issue.title, body: input.issue.body });
  const coordinator = new BoundedTeamExecutionCoordinator(input.worker ?? new PlanningEmployeeWorker(), input.maxRoles ?? 12);
  const execution = await coordinator.run({ issue: input.issue, team });
  const completedRoles = execution.results.map((result) => result.role);
  const context: ContextItem = {
    source: "team.execution",
    summary: `Team lead ${team.lead}; planned ${execution.plannedOrder.join(" -> ")}; completed ${completedRoles.join(" -> ") || "none"}; stop ${execution.stopReason}.`,
    data: {
      issue: input.issue,
      team,
      execution,
    },
  };

  return { issue: input.issue, team, execution, context };
}
