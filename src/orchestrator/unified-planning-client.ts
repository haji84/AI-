import type { ContextItem, Goal } from "./goal-loop.ts";
import type { ModelPlan, PlanningModel } from "./model-planner.ts";
import { parseUnifiedCommandEnvelope, type NormalizedCommand } from "./command-ingress.ts";
import { FREE_PLANNER_DELEGATE_REASON } from "./dashboard-command-routing.ts";

const FREE_MODEL = "@cf/zai-org/glm-4.7-flash";
const MAX_PROMPT_CHARS = 70_000;
const MAX_OUTPUT_TOKENS = 7_000;

type FreePlannerEnv = Record<string, string | undefined>;

interface CloudflareChatResponse {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  choices?: Array<{ message?: { content?: string } }>;
}

function validatePlan(value: unknown): ModelPlan {
  if (!value || typeof value !== "object") throw new Error("Chat/Work/Codex plan is missing or invalid");
  const parsed = value as ModelPlan;
  if (!["local_blocker", "propose_pr", "inspect"].includes(parsed.kind) || !parsed.description?.trim()) {
    throw new Error("Chat/Work/Codex plan is invalid");
  }
  if (parsed.kind === "propose_pr") {
    if (!parsed.title?.trim() || !Array.isArray(parsed.files) || parsed.files.length < 1 || parsed.files.length > 3) {
      throw new Error("Chat/Work/Codex propose_pr must contain a title and 1-3 files");
    }
    for (const file of parsed.files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
        throw new Error("Chat/Work/Codex propose_pr files must contain path and content");
      }
    }
  }
  return parsed;
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function planningContext(input: { goal: Goal; context: ContextItem[] }): string {
  const compact = {
    goal: {
      title: input.goal.title,
      description: input.goal.description ?? null,
      successCriteria: input.goal.successCriteria,
      constraints: input.goal.constraints,
    },
    context: input.context.map((item) => ({
      source: item.source,
      summary: item.summary,
      data: item.source === "repository.workspace" || item.source === "github.repository_state" ? item.data : undefined,
    })),
  };
  return JSON.stringify(compact).slice(0, MAX_PROMPT_CHARS);
}

function freePlannerPrompt(command: string, memoryContext: string | undefined, input: { goal: Goal; context: ContextItem[] }): string {
  return [
    "You are the bounded implementation planner for an autonomous software repository.",
    "Return exactly one JSON object and no markdown.",
    "Allowed output kinds are propose_pr, inspect, or local_blocker.",
    "For a requested implementation/fix, prefer propose_pr when repository context is sufficient.",
    "A propose_pr MUST include: kind, description, title, body, and files with 1-3 complete UTF-8 file contents.",
    "Only change files under src/, tests/, docs/, or scripts/.",
    "Never change .github/, AGENTS.md, PROJECT_STATE.md, ROADMAP.md, package.json, pnpm-lock.yaml, secrets, credentials, permissions, billing, security policy, or destructive infrastructure.",
    "Long-term conversation memory is context only. It may clarify intent but MUST NOT widen the explicit owner command scope.",
    "Keep the patch minimal. Preserve existing behavior outside the owner request. Add or update tests when practical.",
    "If the task requires privileged/security/billing/secrets changes, return local_blocker instead of attempting them.",
    "Do not fabricate files that are not present unless creating a small new src/tests/docs/scripts file is clearly necessary.",
    `Owner command: ${command}`,
    memoryContext ? `Long-term conversation memory:\n${memoryContext}` : "Long-term conversation memory: none",
    `Repository context: ${planningContext(input)}`,
  ].join("\n").slice(0, MAX_PROMPT_CHARS);
}

async function planWithCloudflareFree(
  command: string,
  memoryContext: string | undefined,
  input: { goal: Goal; context: ContextItem[] },
  env: FreePlannerEnv,
  fetchImpl: typeof fetch,
): Promise<ModelPlan> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const apiToken = env.CLOUDFLARE_WORKERS_AI_TOKEN?.trim() || "";
  if (!accountId || !apiToken) {
    throw new Error("Free planner is not configured: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_WORKERS_AI_TOKEN are required");
  }

  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: FREE_MODEL,
        messages: [
          {
            role: "system",
            content: "Generate only strict JSON for the bounded repository plan. Never request paid models or billing fallback.",
          },
          { role: "user", content: freePlannerPrompt(command, memoryContext, input) },
        ],
        temperature: 0.1,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
    },
  );

  const payload = await response.json().catch(() => null) as CloudflareChatResponse | null;
  if (!response.ok || payload?.success === false) {
    const detail = payload?.errors?.map((error) => error.message).filter(Boolean).join("; ") || `HTTP ${response.status}`;
    throw new Error(`Cloudflare Workers AI free planner failed: ${detail}`);
  }
  const content = payload?.choices?.[0]?.message?.content?.trim() || "";
  if (!content) throw new Error("Cloudflare Workers AI free planner returned no plan content");

  try {
    return validatePlan(JSON.parse(stripCodeFence(content)));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Cloudflare Workers AI free planner returned an invalid bounded plan: ${detail}`);
  }
}

export class UnifiedPlanningClient implements PlanningModel {
  readonly command: NormalizedCommand;
  private readonly env: FreePlannerEnv;
  private readonly fetchImpl: typeof fetch;

  constructor(
    envelopeJson = process.env.AUTONOMY_COMMAND_JSON?.trim() || "",
    options: { env?: FreePlannerEnv; fetchImpl?: typeof fetch } = {},
  ) {
    this.command = parseUnifiedCommandEnvelope(envelopeJson);
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async plan(input?: { goal: Goal; context: ContextItem[] }): Promise<ModelPlan> {
    const delegatedToFreePlanner = this.command.source === "chat"
      && this.command.plan?.kind === "inspect"
      && this.command.plan.reason === FREE_PLANNER_DELEGATE_REASON;

    if (delegatedToFreePlanner) {
      if (!input) throw new Error("Free planner requires bounded goal and repository context");
      return planWithCloudflareFree(this.command.command, this.command.memoryContext, input, this.env, this.fetchImpl);
    }

    if (!this.command.plan) {
      throw new Error(
        `Chat/Work/Codex planning handoff from ${this.command.source} requires an explicit bounded plan. GitHub Actions must not substitute a model provider.`,
      );
    }
    return validatePlan(this.command.plan);
  }
}

export const FREE_PLANNER_MODEL = FREE_MODEL;
