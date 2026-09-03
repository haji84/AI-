import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommandIngressSource } from "./command-ingress.ts";
import type { ReasoningUsage } from "./reasoning-router.ts";

interface ReasoningBudgetState extends ReasoningUsage {
  date: string;
}

function dateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function emptyUsage(): ReasoningUsage {
  return { work: 0, codex: 0 };
}

export function reasoningBudgetPath(stateDir: string): string {
  return resolve(stateDir, "reasoning-budget.json");
}

export function readReasoningUsage(stateDir: string, now = new Date()): ReasoningUsage {
  const date = dateKey(now);
  const path = reasoningBudgetPath(stateDir);
  if (!existsSync(path)) return emptyUsage();

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<ReasoningBudgetState>;
    if (parsed.date !== date) return emptyUsage();
    const work = Number(parsed.work);
    const codex = Number(parsed.codex);
    if (!Number.isInteger(work) || work < 0 || !Number.isInteger(codex) || codex < 0) return emptyUsage();
    return { work, codex };
  } catch {
    return emptyUsage();
  }
}

export function recordReasoningUse(
  stateDir: string,
  source: CommandIngressSource | null,
  now = new Date(),
): ReasoningUsage {
  const date = dateKey(now);
  const current = readReasoningUsage(stateDir, now);
  const next: ReasoningBudgetState = { date, ...current };
  if (source === "work") next.work += 1;
  if (source === "codex") next.codex += 1;
  writeFileSync(reasoningBudgetPath(stateDir), `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  return { work: next.work, codex: next.codex };
}
