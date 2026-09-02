import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ContextItem, Goal } from "./goal-loop.ts";
import type { ModelPlan, PlanningModel } from "./model-planner.ts";

const execFileAsync = promisify(execFile);

export interface CopilotCommandRunner {
  run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string>;
}

class NodeCopilotCommandRunner implements CopilotCommandRunner {
  async run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFileAsync(command, args, {
      env,
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
    return stdout;
  }
}

function compactContext(context: ContextItem[]) {
  return context.map((item) => ({
    source: item.source,
    summary: item.summary.slice(0, 12000),
    data: item.source === "parallel.cloud_candidates" || item.source === "repository.workspace" ? item.data : undefined,
  }));
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function validatePlan(value: unknown): ModelPlan {
  if (!value || typeof value !== "object") throw new Error("Copilot CLI returned an invalid bounded plan");
  const parsed = value as ModelPlan;
  if (!["local_blocker", "propose_pr", "inspect"].includes(parsed.kind) || !parsed.description?.trim()) {
    throw new Error("Copilot CLI returned an invalid bounded plan");
  }
  if (parsed.kind === "propose_pr") {
    if (!parsed.title?.trim() || !Array.isArray(parsed.files) || parsed.files.length < 1 || parsed.files.length > 3) {
      throw new Error("Copilot CLI propose_pr must contain a title and 1-3 files");
    }
    for (const file of parsed.files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
        throw new Error("Copilot CLI propose_pr files must contain path and content");
      }
    }
  }
  return parsed;
}

function plannerPrompt(input: { goal: Goal; context: ContextItem[] }): string {
  return [
    "You are a bounded repository planner. Return one JSON object only, with no markdown.",
    "Allowed kind values: local_blocker, propose_pr, inspect.",
    "Never request merge, deployment, secret or permission changes, destructive changes, workflow edits, AGENTS.md, PROJECT_STATE.md, or ROADMAP.md edits.",
    "For propose_pr include title, body, description, and at most 3 complete UTF-8 file replacements under src/, tests/, docs/, or scripts/.",
    "Prefer the smallest verifiable change. Never invent unseen file contents.",
    "If parallel.cloud_candidates is present, choose at most one listed independent cloud-safe issue and keep the primary blocker intact.",
    "Do not use tools. All authoritative context required for planning is embedded below.",
    JSON.stringify({ goal: input.goal, context: compactContext(input.context) }),
  ].join("\n");
}

export class CopilotCliPlanningClient implements PlanningModel {
  private readonly runner: CopilotCommandRunner;
  private readonly command: string;
  private readonly model: string;

  constructor(options: { runner?: CopilotCommandRunner; command?: string; model?: string } = {}) {
    this.runner = options.runner ?? new NodeCopilotCommandRunner();
    this.command = options.command ?? process.env.AUTONOMY_COPILOT_COMMAND?.trim() || "copilot";
    this.model = options.model ?? process.env.AUTONOMY_COPILOT_MODEL?.trim() || "auto";
  }

  async plan(input: { goal: Goal; context: ContextItem[] }): Promise<ModelPlan> {
    const output = await this.runner.run(this.command, [
      "-p",
      plannerPrompt(input),
      "-s",
      "--no-ask-user",
      "--no-color",
      `--model=${this.model}`,
      "--deny-tool=read",
      "--deny-tool=write",
      "--deny-tool=shell",
      "--deny-tool=url",
      "--deny-tool=memory",
    ], process.env);
    if (!output.trim()) throw new Error("Copilot CLI returned no plan content");
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(output));
    } catch {
      throw new Error("Copilot CLI returned non-JSON plan content");
    }
    return validatePlan(parsed);
  }
}
