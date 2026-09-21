import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Verifier } from "./goal-loop.ts";

function localToken(env: Record<string, string | undefined>): string | null {
  const explicit = env.CODE_BUILDER_LOCAL_TOKEN?.trim();
  if (explicit) return explicit;
  if (process.platform !== "win32") return null;
  const root = env.LOCALAPPDATA?.trim();
  if (!root) return null;
  const path = join(root, "GAIWorker", "code-builder", "token.txt");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim() || null;
}

export function createRuntimeDevelopmentVerifier(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Verifier {
  return {
    async verify({ action, result }) {
      if (!result.ok) return { ok: false, summary: result.summary, evidence: result.evidence };
      if (action.capability !== "code.builder") {
        return { ok: true, summary: "Capability execution verified", evidence: result.evidence };
      }
      const input = action.input as { verificationContract?: unknown } | undefined;
      if (!input?.verificationContract) {
        return {
          ok: false,
          summary: "Deterministic development verification contract is missing",
          evidence: { blocker: "development_verification_contract_missing" },
        };
      }
      const token = localToken(env);
      if (!token) {
        return {
          ok: false,
          summary: "Local Builder verification token is unavailable",
          evidence: { blocker: "development_verifier_unavailable" },
        };
      }
      const url = env.CODE_BUILDER_LOCAL_URL?.trim() || "http://127.0.0.1:8796";
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
        return { ok: false, summary: "Development verifier requires loopback Builder", evidence: { blocker: "development_verifier_non_loopback" } };
      }
      try {
        const response = await fetchImpl(`${url.replace(/\/$/, "")}/verify`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ contract: input.verificationContract }),
        });
        const payload = await response.json().catch(() => null) as { ok?: boolean; summary?: string; evidence?: unknown } | null;
        const ok = response.ok && payload?.ok === true;
        const evidence = payload?.evidence as { expected?: unknown; actual?: unknown } | undefined;
        const detail = !ok && evidence && typeof evidence.expected === "string" && typeof evidence.actual === "string"
          ? ` expected=${JSON.stringify(evidence.expected)} actual=${JSON.stringify(evidence.actual)}`
          : "";
        return {
          ok,
          summary: `${payload?.summary ?? `Development verification HTTP ${response.status}`}${detail}`,
          evidence: payload?.evidence,
        };
      } catch (error) {
        return { ok: false, summary: error instanceof Error ? error.message : String(error), evidence: { blocker: "development_verifier_unreachable" } };
      }
    },
  };
}
