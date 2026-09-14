import { resolve } from "node:path";

import { PersistentSkillLibrary, type SkillRecord } from "../gai/skill-library.ts";
import { routeResearchWork, type ResearchWorkKind, type ResearchWorkerState } from "../gai/research-control-plane.ts";
import type { ActionResult, CapabilityExecutor, ContextItem, ProposedAction } from "./goal-loop.ts";

export type AutonomyDelegationTarget = "jarvis" | "skill" | "research";

export interface AutonomyDelegationInput {
  target: AutonomyDelegationTarget;
  operation?: string;
  payload?: Record<string, unknown>;
  targetNodeId?: string;
  priority?: "urgent" | "high" | "normal" | "low" | "background";
  query?: string;
  researchKind?: ResearchWorkKind;
  preferredWorkerId?: string;
}

interface JarvisTaskSnapshot {
  id?: string;
  status?: string;
  result?: unknown;
  failure?: unknown;
}

interface JarvisAdminState {
  tasks?: JarvisTaskSnapshot[];
  fleet?: Array<{
    id?: string;
    kind?: string;
    status?: string;
    capabilities?: string[];
  }>;
}

export interface AutonomyDelegationOptions {
  downstream: CapabilityExecutor;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  skillLibrary?: PersistentSkillLibrary;
  sleep?: (ms: number) => Promise<void>;
  jarvisPollIntervalMs?: number;
  jarvisTimeoutMs?: number;
}

const JARVIS_OPERATIONS = new Set([
  "open-url",
  "open-app",
  "launch-settings",
  "wake-device",
  "device-status",
  "show-notification",
  "lock-device",
  "reboot",
  "ui-sequence",
]);

function inputOf(action: ProposedAction): AutonomyDelegationInput {
  if (!action.input || typeof action.input !== "object" || Array.isArray(action.input)) {
    throw new Error("autonomy.delegate requires structured input");
  }
  const input = action.input as Partial<AutonomyDelegationInput>;
  if (input.target !== "jarvis" && input.target !== "skill" && input.target !== "research") {
    throw new Error("autonomy.delegate target must be jarvis, skill, or research");
  }
  return input as AutonomyDelegationInput;
}

function errorResult(action: ProposedAction, blocker: string, summary: string, evidence?: unknown): ActionResult {
  return { actionId: action.id, ok: false, summary, blocker, evidence };
}

function brokerConfig(env: Record<string, string | undefined>): { url: string; token: string } | null {
  const url = env.JARVIS_BROKER_URL?.trim().replace(/\/$/, "") || "";
  const token = env.JARVIS_OWNER_TOKEN?.trim() || "";
  return url && token ? { url, token } : null;
}

async function jarvisFetch(
  config: { url: string; token: string },
  path: string,
  fetchImpl: typeof fetch,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetchImpl(`${config.url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && typeof (payload as { message?: unknown }).message === "string"
      ? (payload as { message: string }).message
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function researchWorkersFromJarvis(state: JarvisAdminState): ResearchWorkerState[] {
  return (state.fleet ?? [])
    .filter((node) => typeof node.id === "string")
    .map((node) => ({
      id: node.id as string,
      platform: node.kind === "mac" ? "macos" : node.kind === "windows" ? "windows" : "linux",
      online: node.status === "ready" || node.status === "busy",
      busy: node.status === "busy",
      capabilities: (node.capabilities ?? []).filter((capability): capability is ResearchWorkerState["capabilities"][number] =>
        ["local-model", "gpu", "browser", "filesystem", "long-running", "macos-tooling", "windows-tooling"].includes(capability),
      ),
    }));
}

function parseExecutableSkill(skill: SkillRecord): { capability: string; input?: unknown } | null {
  try {
    const parsed = JSON.parse(skill.procedure) as { capability?: unknown; input?: unknown };
    if (!parsed || typeof parsed.capability !== "string" || !parsed.capability.trim()) return null;
    if (parsed.capability === "autonomy.delegate") return null;
    return { capability: parsed.capability.trim(), input: parsed.input };
  } catch {
    return null;
  }
}

export function createAutonomyDelegationCapability(options: AutonomyDelegationOptions) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms)));
  const pollInterval = options.jarvisPollIntervalMs ?? 750;
  const timeout = options.jarvisTimeoutMs ?? 60_000;
  const skillLibrary = options.skillLibrary ?? new PersistentSkillLibrary(
    env.AUTONOMY_SKILL_LIBRARY_PATH?.trim() || resolve(process.cwd(), ".autonomy-state", "skills.json"),
  );

  return {
    name: "autonomy.delegate",
    async execute(action: ProposedAction, context: ContextItem[]): Promise<ActionResult> {
      let input: AutonomyDelegationInput;
      try {
        input = inputOf(action);
      } catch (error) {
        return errorResult(action, "INVALID_DELEGATION", error instanceof Error ? error.message : "invalid delegation");
      }

      if (input.target === "jarvis") {
        if (!input.operation || !JARVIS_OPERATIONS.has(input.operation)) {
          return errorResult(action, "JARVIS_OPERATION_UNSUPPORTED", `Unsupported JARVIS operation: ${input.operation ?? "missing"}`);
        }
        const config = brokerConfig(env);
        if (!config) {
          return errorResult(action, "JARVIS_BROKER_UNAVAILABLE", "JARVIS broker URL/token are not configured for this runtime");
        }
        try {
          const accepted = await jarvisFetch(config, "/api/jarvis/admin/tasks", fetchImpl, {
            method: "POST",
            body: JSON.stringify({
              type: input.operation,
              payload: input.payload ?? {},
              targetNodeId: input.targetNodeId || undefined,
              priority: input.priority ?? "normal",
            }),
          }) as { task?: JarvisTaskSnapshot };
          const taskId = accepted.task?.id;
          if (!taskId) return errorResult(action, "JARVIS_TASK_REJECTED", "JARVIS broker did not return a task id", accepted);

          const deadline = Date.now() + timeout;
          while (Date.now() < deadline) {
            const state = await jarvisFetch(config, "/api/jarvis/admin/state", fetchImpl) as JarvisAdminState;
            const task = (state.tasks ?? []).find((item) => item.id === taskId);
            if (task?.status === "completed") {
              return {
                actionId: action.id,
                ok: true,
                summary: `JARVIS completed ${input.operation}`,
                evidence: { taskId, task, targetNodeId: input.targetNodeId ?? null },
              };
            }
            if (task && ["failed", "cancelled"].includes(task.status ?? "")) {
              return errorResult(action, "JARVIS_TASK_FAILED", `JARVIS task ${taskId} ended as ${task.status}`, task);
            }
            await sleep(pollInterval);
          }
          return errorResult(action, "JARVIS_TASK_TIMEOUT", `JARVIS task ${taskId} did not finish within ${timeout}ms`, { taskId });
        } catch (error) {
          return errorResult(action, "JARVIS_EXECUTION_ERROR", error instanceof Error ? error.message : String(error));
        }
      }

      if (input.target === "skill") {
        const query = input.query?.trim() || action.description;
        const matches = await skillLibrary.query(query, 5);
        const skill = matches[0];
        if (!skill) return errorResult(action, "SKILL_NOT_FOUND", `No active skill matched: ${query}`);
        const executable = parseExecutableSkill(skill);
        if (!executable) {
          return errorResult(
            action,
            "SKILL_RUNTIME_UNAVAILABLE",
            `Skill ${skill.id} matched but its procedure is not an executable capability descriptor`,
            { skillId: skill.id, name: skill.name, confidence: skill.confidence },
          );
        }
        const delegatedAction: ProposedAction = {
          ...action,
          id: `${action.id}:skill:${skill.id}`,
          capability: executable.capability,
          input: executable.input,
        };
        const result = await options.downstream.execute(delegatedAction, context);
        await skillLibrary.recordOutcome(skill.id, result.ok);
        return {
          ...result,
          actionId: action.id,
          evidence: { skillId: skill.id, delegatedCapability: executable.capability, result: result.evidence },
        };
      }

      const config = brokerConfig(env);
      let workers: ResearchWorkerState[] = [];
      if (config) {
        try {
          const state = await jarvisFetch(config, "/api/jarvis/admin/state", fetchImpl) as JarvisAdminState;
          workers = researchWorkersFromJarvis(state);
        } catch {
          workers = [];
        }
      }
      const researchKind = input.researchKind ?? "local-safe";
      const route = routeResearchWork({
        id: action.id,
        kind: researchKind,
        preferredWorkerId: input.preferredWorkerId,
      }, workers);
      return errorResult(
        action,
        route.action === "defer" ? route.queueState ?? "RESEARCH_DEFERRED" : "RESEARCH_EXECUTOR_UNAVAILABLE",
        route.action === "run-hosted"
          ? `Research control plane selected hosted execution, but no general research executor is registered yet: ${route.reason}`
          : route.action === "run-worker"
            ? `Research control plane selected worker ${route.workerId}, but no general research task adapter is registered yet`
            : route.reason,
        route,
      );
    },
  };
}
