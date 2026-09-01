import type { CompassStore, StatePatch, VerificationStatus, WriteBackInput } from "./store.ts";

export const COMPASS_TOOL_NAMES = [
  "get_goal",
  "set_goal",
  "get_state",
  "update_state",
  "get_next_action",
  "set_next_action",
  "record_verification",
  "write_back",
  "get_history",
] as const;

export type CompassToolName = (typeof COMPASS_TOOL_NAMES)[number];

export interface CompassToolDefinition {
  name: CompassToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const COMPASS_TOOLS: CompassToolDefinition[] = [
  {
    name: "get_goal",
    description: "Return the current Compass project goal or null when no goal has been set.",
    inputSchema: objectSchema({}),
  },
  {
    name: "set_goal",
    description: "Create or replace the current Compass project goal.",
    inputSchema: objectSchema(
      {
        title: { type: "string", minLength: 1 },
        description: { type: "string" },
        successCriteria: { type: "array" },
        constraints: { type: "array" },
      },
      ["title"],
    ),
  },
  {
    name: "get_state",
    description: "Return the current persistent Compass state.",
    inputSchema: objectSchema({}),
  },
  {
    name: "update_state",
    description: "Patch explicitly supplied Compass state fields without erasing unrelated fields.",
    inputSchema: objectSchema({
      phase: { type: ["string", "null"] },
      status: { type: ["string", "null"] },
      completed: { type: "array" },
      active: { type: "array" },
      blockers: { type: "array" },
      verificationSummary: { type: ["string", "null"] },
      nextAction: { type: ["string", "null"] },
    }),
  },
  {
    name: "get_next_action",
    description: "Return the single current next action or null.",
    inputSchema: objectSchema({}),
  },
  {
    name: "set_next_action",
    description: "Set or clear the single current next action.",
    inputSchema: objectSchema({ nextAction: { type: ["string", "null"] } }, ["nextAction"]),
  },
  {
    name: "record_verification",
    description: "Append a PASS or FAIL verification record with optional evidence.",
    inputSchema: objectSchema(
      {
        status: { type: "string", enum: ["PASS", "FAIL"] },
        summary: { type: "string", minLength: 1 },
        evidence: {},
      },
      ["status", "summary"],
    ),
  },
  {
    name: "write_back",
    description: "Atomically append task history and update state, verification, and next action.",
    inputSchema: objectSchema(
      {
        status: { type: "string", minLength: 1 },
        summary: { type: "string", minLength: 1 },
        completed: { type: "array" },
        blockers: { type: "array" },
        active: { type: "array" },
        phase: { type: ["string", "null"] },
        verification: objectSchema(
          {
            status: { type: "string", enum: ["PASS", "FAIL"] },
            summary: { type: "string", minLength: 1 },
            evidence: {},
          },
          ["status", "summary"],
        ),
        nextAction: { type: ["string", "null"] },
      },
      ["status", "summary"],
    ),
  },
  {
    name: "get_history",
    description: "Return recent Compass write-back history newest-first.",
    inputSchema: objectSchema({ limit: { type: "integer", minimum: 1, maximum: 100 } }),
  },
];

function asObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") throw new Error(`${field} must be a string or null`);
  return value;
}

function optionalArray(value: unknown, field: string): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

export function invokeCompassTool(store: CompassStore, name: string, rawArgs?: unknown): unknown {
  if (!COMPASS_TOOL_NAMES.includes(name as CompassToolName)) throw new Error(`unknown Compass tool: ${name}`);
  const args = asObject(rawArgs);

  switch (name as CompassToolName) {
    case "get_goal":
      return store.getGoal();
    case "set_goal":
      return store.setGoal({
        title: requiredString(args.title, "title"),
        description: args.description === undefined ? undefined : requiredString(args.description, "description"),
        successCriteria: optionalArray(args.successCriteria, "successCriteria"),
        constraints: optionalArray(args.constraints, "constraints"),
      });
    case "get_state":
      return store.getState();
    case "update_state": {
      const patch: StatePatch = {
        phase: optionalString(args.phase, "phase"),
        status: optionalString(args.status, "status"),
        completed: optionalArray(args.completed, "completed"),
        active: optionalArray(args.active, "active"),
        blockers: optionalArray(args.blockers, "blockers"),
        verificationSummary: optionalString(args.verificationSummary, "verificationSummary"),
        nextAction: optionalString(args.nextAction, "nextAction"),
      };
      for (const key of Object.keys(patch) as (keyof StatePatch)[]) {
        if (patch[key] === undefined) delete patch[key];
      }
      return store.updateState(patch);
    }
    case "get_next_action":
      return { nextAction: store.getNextAction() };
    case "set_next_action":
      if (!("nextAction" in args)) throw new Error("nextAction is required");
      return store.setNextAction(optionalString(args.nextAction, "nextAction") ?? null);
    case "record_verification": {
      const status = requiredString(args.status, "status") as VerificationStatus;
      return store.recordVerification({
        status,
        summary: requiredString(args.summary, "summary"),
        evidence: args.evidence,
      });
    }
    case "write_back": {
      const verificationRaw = args.verification;
      let verification: WriteBackInput["verification"];
      if (verificationRaw !== undefined) {
        const verificationArgs = asObject(verificationRaw);
        verification = {
          status: requiredString(verificationArgs.status, "verification.status") as VerificationStatus,
          summary: requiredString(verificationArgs.summary, "verification.summary"),
          evidence: verificationArgs.evidence,
        };
      }
      return store.writeBack({
        status: requiredString(args.status, "status"),
        summary: requiredString(args.summary, "summary"),
        completed: optionalArray(args.completed, "completed"),
        blockers: optionalArray(args.blockers, "blockers"),
        active: optionalArray(args.active, "active"),
        phase: optionalString(args.phase, "phase"),
        verification,
        nextAction: optionalString(args.nextAction, "nextAction"),
      });
    }
    case "get_history": {
      const limit = args.limit === undefined ? 20 : args.limit;
      if (!Number.isInteger(limit)) throw new Error("limit must be an integer");
      return store.getHistory(limit as number);
    }
  }
}
