import type { ContextItem, Goal, InferredIntent, Planner, ProposedAction } from "./goal-loop.ts";
import { inferIntentFromSignals } from "./intent.ts";

export interface ModelPlanFile { path: string; content: string; }
export interface ModelPlan {
  kind: "local_blocker" | "propose_pr" | "inspect";
  description: string;
  reason?: string;
  title?: string;
  body?: string;
  files?: ModelPlanFile[];
}

export interface PlanningModel {
  plan(input: { goal: Goal; context: ContextItem[] }): Promise<ModelPlan>;
}

export interface ParallelCloudCandidate {
  number: number;
  title: string;
  body: string;
  url?: string;
}

const LOCAL_MARKERS = [
  "real-machine",
  "real machine",
  "workstation",
  "actual local comfyui",
  "local comfyui",
  "qwen-image-edit smoke",
  "local runtime",
  "gpu",
];

function repositoryState(context: ContextItem[]): string {
  return context.find((item) => item.source === "repository.file:PROJECT_STATE.md")?.summary ?? "";
}

function isLocalOnlyText(value: string): boolean {
  const text = value.toLowerCase();
  return LOCAL_MARKERS.some((marker) => text.includes(marker));
}

export function detectLocalOnlyBlocker(context: ContextItem[]): string | null {
  if (isLocalOnlyText(repositoryState(context))) {
    return "Current explicit PROJECT_STATE requires a real-machine/local runtime step that a GitHub-hosted runner cannot truthfully perform.";
  }
  return null;
}

export function parallelCloudCandidates(context: ContextItem[]): ParallelCloudCandidate[] {
  const github = context.find((item) => item.source === "github.repository_state")?.data as {
    openIssues?: unknown;
  } | undefined;
  if (!github || !Array.isArray(github.openIssues)) return [];

  const candidates: ParallelCloudCandidate[] = [];
  for (const raw of github.openIssues) {
    if (!raw || typeof raw !== "object") continue;
    const issue = raw as Record<string, unknown>;
    if (issue.pull_request) continue;
    const number = typeof issue.number === "number" ? issue.number : Number(issue.number);
    const title = typeof issue.title === "string" ? issue.title.trim() : "";
    const body = typeof issue.body === "string" ? issue.body.trim() : "";
    if (!Number.isInteger(number) || number < 1 || !title) continue;
    if (isLocalOnlyText(`${title}\n${body}`)) continue;
    candidates.push({
      number,
      title,
      body: body.slice(0, 8000),
      url: typeof issue.html_url === "string" ? issue.html_url : undefined,
    });
  }

  return candidates.slice(0, 5);
}

export class ModelBackedPlanner implements Planner {
  private readonly model: PlanningModel;
  constructor(model: PlanningModel) { this.model = model; }

  async inferIntent(input: { goal: Goal; context: ContextItem[]; preferences?: string[]; recentDecisions?: string[] }): Promise<InferredIntent> {
    return inferIntentFromSignals(input);
  }

  async proposeNextAction(input: { goal: Goal; context: ContextItem[]; intent: InferredIntent }): Promise<ProposedAction | null> {
    if (input.context.some((item) => item.source === "goal.complete" && item.summary === "true")) return null;
    const local = detectLocalOnlyBlocker(input.context);
    const candidates = local ? parallelCloudCandidates(input.context) : [];
    if (local && candidates.length === 0) {
      return {
        id: "cloud:local-runtime-required",
        description: local,
        capability: "runtime.local_blocker",
        risk: "low",
        irreversible: false,
        externalSideEffect: false,
      };
    }

    const planningContext = local
      ? [
          ...input.context,
          {
            source: "parallel.cloud_candidates",
            summary: `Primary task is blocked locally. Choose at most one independent cloud-safe issue without advancing the blocked phase: ${candidates.map((candidate) => `#${candidate.number} ${candidate.title}`).join(" | ")}`,
            data: { primaryBlocker: local, candidates },
          },
        ]
      : input.context;

    const plan = await this.model.plan({ goal: input.goal, context: planningContext });
    if (plan.kind === "local_blocker") {
      return { id: "model:local-blocker", description: plan.reason || plan.description, capability: "runtime.local_blocker", risk: "low" };
    }
    if (plan.kind === "propose_pr") {
      return {
        id: `model:propose-pr:${Date.now()}`,
        description: plan.description,
        capability: "repository.propose_pr",
        risk: "low",
        irreversible: false,
        externalSideEffect: true,
        input: { title: plan.title, body: plan.body, files: plan.files },
      };
    }
    if (local) {
      return {
        id: "cloud:local-runtime-required",
        description: `${local} Parallel cloud-safe candidates were found, but no bounded change was proposed.`,
        capability: "runtime.local_blocker",
        risk: "low",
      };
    }
    return { id: "model:inspect", description: plan.description, capability: "context.inspect", risk: "low" };
  }
}

export class GitHubModelsPlanningClient implements PlanningModel {
  private readonly token: string;
  private readonly model: string;
  constructor(token: string, model = process.env.AUTONOMY_MODEL?.trim() || "openai/gpt-4.1-mini") {
    this.token = token;
    this.model = model;
  }

  async plan(input: { goal: Goal; context: ContextItem[] }): Promise<ModelPlan> {
    if (!this.token.trim()) return { kind: "inspect", description: "GitHub Models token unavailable; inspect context only." };
    const compact = input.context.map((item) => ({ source: item.source, summary: item.summary.slice(0, 12000), data: item.source === "parallel.cloud_candidates" ? item.data : undefined }));
    const response = await fetch("https://models.github.ai/inference/chat/completions", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 5000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a bounded repository planner. Return JSON only. Choose kind local_blocker, propose_pr, or inspect. Never request merge, deployment, secret/permission changes, destructive changes, workflow edits, AGENTS.md, PROJECT_STATE.md, or ROADMAP.md edits. For propose_pr include title, body, and at most 3 complete UTF-8 file replacements under src/, tests/, docs/, or scripts/. Prefer the smallest verifiable change. If parallel.cloud_candidates is present, the primary phase is blocked by a local-only task: choose at most one listed independent cloud-safe issue, do not invent work, do not claim the blocked phase is complete, and keep the local blocker intact." },
          { role: "user", content: JSON.stringify({ goal: input.goal, context: compact }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`GitHub Models HTTP ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("GitHub Models returned no plan content");
    const parsed = JSON.parse(content) as ModelPlan;
    if (!parsed || !["local_blocker", "propose_pr", "inspect"].includes(parsed.kind) || !parsed.description?.trim()) {
      throw new Error("GitHub Models returned an invalid bounded plan");
    }
    if (parsed.kind === "propose_pr" && (!Array.isArray(parsed.files) || parsed.files.length < 1 || parsed.files.length > 3)) {
      throw new Error("GitHub Models propose_pr must contain 1-3 files");
    }
    return parsed;
  }
}

export function createLocalBlockerCapability() {
  return {
    name: "runtime.local_blocker",
    async execute(action: ProposedAction) {
      return { actionId: action.id, ok: false, summary: action.description, blocker: "local_runtime_required" };
    },
  };
}
