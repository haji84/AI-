import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Verifier } from "./goal-loop.ts";
import { reviewRuntimeCandidate } from "./runtime-ollama-review-checkpoint.mjs";
import { ResourceWaitError, withDevelopmentResourceAdmission } from "../gai/development-resource-admission.ts";

function localToken(env: Record<string, string | undefined>): string | null {
  const explicit = env.CODE_BUILDER_LOCAL_TOKEN?.trim();
  if (explicit) return explicit;
  let path: string | null = null;
  if (process.platform === "win32") {
    const root = env.LOCALAPPDATA?.trim();
    if (root) path = join(root, "GAIWorker", "code-builder", "token.txt");
  } else if (process.platform === "darwin") {
    path = join(homedir(), "Library", "Application Support", "GAIWorker", "code-builder", "token.txt");
  }
  if (!path || !existsSync(path)) return null;
  return readFileSync(path, "utf8").trim() || null;
}

export function createRuntimeDevelopmentVerifier(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  resourceAdmission: typeof withDevelopmentResourceAdmission = withDevelopmentResourceAdmission,
): Verifier {
  return {
    async verify({ action, result }) {
      if (!result.ok) return { ok: false, summary: result.summary, evidence: result.evidence };
      if (action.capability !== "code.builder") {
        return { ok: true, summary: "Capability execution verified", evidence: result.evidence };
      }
      // The existing 8796 Builder /verify endpoint is not a distinct verifier
      // for a local Ollama-written artifact. Until a trusted independently
      // rooted process is configured and attested, fail closed in local mode.
      if (env.GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED?.trim() === "1") {
        return {
          ok: false,
          summary: "Independent local Ollama executable verifier is not configured",
          evidence: { blocker: "independent_local_ollama_verifier_required" },
        };
      }
      const input = action.input as {
        verificationContract?: unknown;
        candidate?: { artifactRef?: string; changedPaths?: string[] };
        releaseBinding?: { builderId?: string; sourceRevision?: string; artifactDigest?: string };
      } | undefined;
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
          body: JSON.stringify({ contract: input.verificationContract, candidate: input.candidate, binding: input.releaseBinding }),
        });
        const payload = await response.json().catch(() => null) as { ok?: boolean; summary?: string; evidence?: unknown; blocker?: string; resourceWait?: unknown } | null;
        if (response.status === 503 && payload?.blocker === "WAITING_FOR_RESOURCE") {
          return { ok: false, summary: "Development verification is waiting for resources", evidence: { resourceWait: payload.resourceWait } };
        }
        let ok = response.ok && payload?.ok === true;
        const evidence = payload?.evidence as {
          expected?: unknown;
          actual?: unknown;
          verifierId?: unknown;
          sourceRevision?: unknown;
          artifactDigest?: unknown;
          verificationEvidence?: Array<{ check?: unknown; verifierId?: unknown; sourceRevision?: unknown; artifactDigest?: unknown; status?: unknown; recordedAt?: unknown }>;
        } | undefined;
        if (ok && input.releaseBinding) {
          const binding = input.releaseBinding;
          ok = typeof evidence?.verifierId === "string"
            && evidence.verifierId !== binding.builderId
            && evidence.sourceRevision === binding.sourceRevision
            && evidence.artifactDigest === binding.artifactDigest;
          const requiredChecks = (input.verificationContract as { requiredChecks?: unknown }).requiredChecks;
          if (ok && Array.isArray(requiredChecks)) {
            ok = requiredChecks.every((check) => evidence?.verificationEvidence?.some((item) =>
              item.check === check
              && item.verifierId === evidence.verifierId
              && item.verifierId !== binding.builderId
              && item.sourceRevision === binding.sourceRevision
              && item.artifactDigest === binding.artifactDigest
              && item.status === "passed"
              && typeof item.recordedAt === "string"
              && Number.isFinite(Date.parse(item.recordedAt)),
            ));
          }
          if (!ok) {
            return {
              ok: false,
              summary: "Development verification evidence is not independently bound to the requested release artifact",
              evidence: { blocker: "development_verification_evidence_invalid" },
            };
          }
        }
        let localModelReview;
        if (ok && env.GORIQ_LOCAL_REVIEW_CONFIG_JSON !== undefined) {
          let config;
          try { config = JSON.parse(env.GORIQ_LOCAL_REVIEW_CONFIG_JSON); }
          catch {
            return { ok: false, summary: "Local model review configuration is invalid", evidence: { blocker: "LOCAL_REVIEW_CONFIGURATION_INVALID" } };
          }
          localModelReview = await reviewRuntimeCandidate({ config, actionId: action.id, input, evidence, fetchImpl, resourceAdmission });
          if (!localModelReview.ok) {
            return { ok: false, summary: `Additional local model review: ${localModelReview.blocker ?? localModelReview.status}`,
              evidence: { blocker: localModelReview.blocker ?? localModelReview.status, localModelReview } };
          }
        }
        const detail = !ok && evidence && typeof evidence.expected === "string" && typeof evidence.actual === "string"
          ? ` expected=${JSON.stringify(evidence.expected)} actual=${JSON.stringify(evidence.actual)}`
          : "";
        return {
          ok,
          summary: `${payload?.summary ?? `Development verification HTTP ${response.status}`}${detail}`,
          evidence: localModelReview ? { ...(payload?.evidence as Record<string, unknown>), localModelReview } : payload?.evidence,
        };
      } catch (error) {
        if (error instanceof ResourceWaitError) throw error;
        return { ok: false, summary: error instanceof Error ? error.message : String(error), evidence: { blocker: "development_verifier_unreachable" } };
      }
    },
  };
}
