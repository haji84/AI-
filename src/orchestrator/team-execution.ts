import type { EmployeeRole, TeamComposition } from "./team-composer.ts";

export type EmployeeWorkResult = {
  ok: boolean;
  summary: string;
  blocker?: string;
  requiresApproval?: boolean;
};

export type EmployeeWorkInput = {
  role: EmployeeRole;
  issue: { title: string; body?: string | null };
  team: TeamComposition;
  priorResults: RoleExecutionResult[];
};

export interface EmployeeWorker {
  run(input: EmployeeWorkInput): Promise<EmployeeWorkResult>;
}

export type RoleExecutionResult = {
  role: EmployeeRole;
  ok: boolean;
  summary: string;
  blocker?: string;
  requiresApproval?: boolean;
};

export type TeamExecutionStopReason =
  | "completed"
  | "role_failed"
  | "blocked"
  | "approval_required"
  | "cycle_limit";

export type TeamExecutionReport = {
  plannedOrder: EmployeeRole[];
  results: RoleExecutionResult[];
  stopReason: TeamExecutionStopReason;
  nextRole: EmployeeRole | null;
};

const SUPPORT_ORDER: EmployeeRole[] = ["QA", "Reviewer", "Release Manager"];

function includesRole(team: TeamComposition, role: EmployeeRole): boolean {
  return team.members.some((member) => member.role === role);
}

export function buildTeamExecutionOrder(team: TeamComposition): EmployeeRole[] {
  const ordered: EmployeeRole[] = [];
  const add = (role: EmployeeRole) => {
    if (includesRole(team, role) && !ordered.includes(role)) ordered.push(role);
  };

  add("PM");

  // Governor moves ahead of production work whenever the issue carries an explicit Human Gate signal.
  if (team.humanGateSignals.length > 0) add("Governor");

  for (const member of team.members) {
    if (["PM", "Governor", ...SUPPORT_ORDER].includes(member.role)) continue;
    add(member.role);
  }

  for (const role of SUPPORT_ORDER) add(role);

  // A Governor without an explicit pre-work gate still participates as the final safety check.
  if (team.humanGateSignals.length === 0) add("Governor");

  return ordered;
}

export class BoundedTeamExecutionCoordinator {
  private readonly worker: EmployeeWorker;
  private readonly maxRoles: number;

  constructor(worker: EmployeeWorker, maxRoles = 12) {
    this.worker = worker;
    this.maxRoles = Math.max(1, maxRoles);
  }

  async run(input: {
    issue: { title: string; body?: string | null };
    team: TeamComposition;
  }): Promise<TeamExecutionReport> {
    const plannedOrder = buildTeamExecutionOrder(input.team);
    const results: RoleExecutionResult[] = [];

    for (let index = 0; index < plannedOrder.length; index += 1) {
      const role = plannedOrder[index];
      if (index >= this.maxRoles) {
        return { plannedOrder, results, stopReason: "cycle_limit", nextRole: role };
      }

      const raw = await this.worker.run({
        role,
        issue: input.issue,
        team: input.team,
        priorResults: [...results],
      });
      const result: RoleExecutionResult = { role, ...raw };
      results.push(result);

      if (result.requiresApproval) {
        return { plannedOrder, results, stopReason: "approval_required", nextRole: plannedOrder[index + 1] ?? null };
      }
      if (result.blocker) {
        return { plannedOrder, results, stopReason: "blocked", nextRole: plannedOrder[index + 1] ?? null };
      }
      if (!result.ok) {
        return { plannedOrder, results, stopReason: "role_failed", nextRole: plannedOrder[index + 1] ?? null };
      }

      // Explicit gated Issue content must stop after Governor assessment and before production work.
      if (role === "Governor" && input.team.humanGateSignals.length > 0) {
        return { plannedOrder, results, stopReason: "approval_required", nextRole: plannedOrder[index + 1] ?? null };
      }
    }

    return { plannedOrder, results, stopReason: "completed", nextRole: null };
  }
}
