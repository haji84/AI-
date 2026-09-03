import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseUnifiedCommandEnvelope } from "./command-ingress.ts";

const DEFAULT_FILENAME = "last-command.json";

export interface ResolvePersistentCommandOptions {
  explicitJson?: string | null;
  stateDir: string;
  filename?: string;
}

export interface InvalidateClosedTargetOptions {
  envelopeJson: string;
  stateDir: string;
  openIssueNumbers: readonly number[];
  filename?: string;
}

function validateCommandJson(json: string): string {
  const trimmed = json.trim();
  parseUnifiedCommandEnvelope(trimmed);
  return trimmed;
}

export function commandTargetIssueNumber(envelopeJson: string): number | undefined {
  const command = parseUnifiedCommandEnvelope(envelopeJson).command;
  const match = command.match(/\bIssue\s*#(\d+)\b/i);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export function invalidatePersistedCommandIfTargetClosed({
  envelopeJson,
  stateDir,
  openIssueNumbers,
  filename = DEFAULT_FILENAME,
}: InvalidateClosedTargetOptions): number | undefined {
  const target = commandTargetIssueNumber(envelopeJson);
  if (!target || openIssueNumbers.includes(target)) return undefined;

  rmSync(resolve(stateDir, filename), { force: true });
  return target;
}

export function resolvePersistentCommandEnvelope({
  explicitJson,
  stateDir,
  filename = DEFAULT_FILENAME,
}: ResolvePersistentCommandOptions): string {
  const commandPath = resolve(stateDir, filename);
  const explicit = explicitJson?.trim() ?? "";

  if (explicit) {
    const validated = validateCommandJson(explicit);
    writeFileSync(commandPath, `${validated}\n`, "utf-8");
    return validated;
  }

  if (!existsSync(commandPath)) {
    throw new Error("Chat/Work/Codex command handoff is required and no persisted command is available");
  }

  return validateCommandJson(readFileSync(commandPath, "utf-8"));
}
