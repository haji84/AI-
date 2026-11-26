import type { withDevelopmentResourceAdmission } from "../src/gai/development-resource-admission.ts";

export interface OllamaRepairInput { workspace?: string; prompt: string; model?: string; endpoint?: string }
export interface OllamaRepairOptions { admit?: typeof withDevelopmentResourceAdmission; fetchImpl?: typeof fetch; timeoutMs?: number }
export function runOllamaRepair(input: OllamaRepairInput, options?: OllamaRepairOptions): Promise<{ ok: true; model: string; changed: number }>;
