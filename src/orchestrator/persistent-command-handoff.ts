import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseUnifiedCommandEnvelope } from "./command-ingress.ts";

const DEFAULT_FILENAME = "last-command.json";

export interface ResolvePersistentCommandOptions {
  explicitJson?: string | null;
  stateDir: string;
  filename?: string;
}

function validateCommandJson(json: string): string {
  const trimmed = json.trim();
  parseUnifiedCommandEnvelope(trimmed);
  return trimmed;
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
