import type { Goal } from "./goal-loop.ts";

export interface CapabilityDescriptor {
  name: string;
  roles: string[];
  matchTerms?: string[];
  alwaysInclude?: boolean;
}

export interface CapabilityRequirement {
  role: string;
  capability: string;
  required?: boolean;
  reason: string;
}

export interface CapabilityAssignment {
  role: string;
  capability: string;
  reason: string;
  source: "core" | "requirement" | "goal-match";
}

export interface CapabilityTeamPlan {
  goalTitle: string;
  assignments: CapabilityAssignment[];
  missingRequiredCapabilities: CapabilityRequirement[];
  blocked: boolean;
}

export interface AssembleCapabilityTeamInput {
  goal: Goal;
  availableCapabilities: CapabilityDescriptor[];
  requirements?: CapabilityRequirement[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function goalText(goal: Goal): string {
  return [goal.title, goal.description ?? "", ...goal.successCriteria, ...goal.constraints]
    .join(" ")
    .toLowerCase();
}

function assignmentKey(assignment: Pick<CapabilityAssignment, "role" | "capability">): string {
  return `${normalize(assignment.role)}::${normalize(assignment.capability)}`;
}

/**
 * Deterministically assembles the smallest capability team supported by the
 * currently available registry catalog. Planning/reasoning may provide
 * explicit requirements, while simple goals can also activate capabilities
 * through descriptor match terms.
 *
 * This function never invents an unavailable capability. Required missing
 * capabilities are reported as blockers instead.
 */
export function assembleCapabilityTeam(input: AssembleCapabilityTeamInput): CapabilityTeamPlan {
  const availableByName = new Map(
    input.availableCapabilities.map((capability) => [normalize(capability.name), capability] as const),
  );
  const assignments = new Map<string, CapabilityAssignment>();
  const missingRequiredCapabilities: CapabilityRequirement[] = [];
  const text = goalText(input.goal);

  const addAssignment = (assignment: CapabilityAssignment) => {
    const key = assignmentKey(assignment);
    if (!assignments.has(key)) assignments.set(key, assignment);
  };

  for (const capability of input.availableCapabilities) {
    if (capability.alwaysInclude) {
      const roles = capability.roles.length > 0 ? capability.roles : [capability.name];
      for (const role of roles) {
        addAssignment({
          role,
          capability: capability.name,
          reason: "core capability required for every goal",
          source: "core",
        });
      }
    }
  }

  for (const requirement of input.requirements ?? []) {
    const capability = availableByName.get(normalize(requirement.capability));
    if (!capability) {
      if (requirement.required !== false) missingRequiredCapabilities.push(requirement);
      continue;
    }
    addAssignment({
      role: requirement.role,
      capability: capability.name,
      reason: requirement.reason,
      source: "requirement",
    });
  }

  for (const capability of input.availableCapabilities) {
    const matchedTerm = capability.matchTerms
      ?.map(normalize)
      .filter(Boolean)
      .find((term) => text.includes(term));
    if (!matchedTerm) continue;

    const roles = capability.roles.length > 0 ? capability.roles : [capability.name];
    for (const role of roles) {
      addAssignment({
        role,
        capability: capability.name,
        reason: `goal matched capability term: ${matchedTerm}`,
        source: "goal-match",
      });
    }
  }

  return {
    goalTitle: input.goal.title,
    assignments: [...assignments.values()].sort((a, b) => {
      const capabilityOrder = a.capability.localeCompare(b.capability);
      return capabilityOrder !== 0 ? capabilityOrder : a.role.localeCompare(b.role);
    }),
    missingRequiredCapabilities: [...missingRequiredCapabilities].sort((a, b) =>
      a.capability.localeCompare(b.capability),
    ),
    blocked: missingRequiredCapabilities.length > 0,
  };
}
