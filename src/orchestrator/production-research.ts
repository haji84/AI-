import { createHash } from "node:crypto";
import type { FactClaim, FactSource, SourceClass } from "./fact-verifier.ts";
import { verifyFacts } from "./fact-verifier.ts";
import { boundedInteger, readResearchSource, researchUrl } from "./research-transport.ts";
import type { ResearchTransportOptions } from "./research-transport.ts";

export interface ProductionResearchSource { url: string; sourceClass: SourceClass; }
export interface ProductionResearchClaim {
  id: string; value: unknown; required: boolean; jsonField: string; sources: ProductionResearchSource[];
  publishedAtField?: string; maxAgeMs?: number;
}
export interface ResearchFetchEvidence { url: string; retrievedAt: string; sha256: string; sourceClass: SourceClass; claimId: string; publishedAt?: string; }
export interface ProductionResearchInput extends ResearchTransportOptions {
  claims: ProductionResearchClaim[]; now?: () => Date;
  /** Host-owned source authority policy. A claim's sourceClass is descriptive only. */
  classify?: (url: URL) => SourceClass;
  totalTimeoutMs?: number;
  maxTotalBytes?: number;
}
function validField(field: string) {
  return typeof field === "string" && field.length > 0 && field.length <= 128 && !["__proto__", "constructor", "prototype"].includes(field);
}
function assertFiniteJson(value: unknown) {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 10_000 || depth > 32) throw new Error("finite JSON complexity limit");
    if (item === null || typeof item === "boolean" || typeof item === "string") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (Array.isArray(item)) { for (const child of item) visit(child, depth + 1); return; }
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      for (const child of Object.values(item)) visit(child, depth + 1);
      return;
    }
    throw new Error("expected finite JSON values");
  };
  visit(value, 0);
}
export async function runProductionResearch(input: ProductionResearchInput) {
  if (!Array.isArray(input.claims) || !input.claims.length || input.claims.length > 20) throw new Error("research claim limit");
  const seen = new Set<string>();
  let sourceCount = 0;
  for (const claim of input.claims) {
    if (!claim || typeof claim.id !== "string" || !claim.id || claim.id.length > 128 || seen.has(claim.id) ||
        typeof claim.required !== "boolean" || !validField(claim.jsonField)) throw new Error("invalid research claim");
    assertFiniteJson(claim.value);
    seen.add(claim.id);
    if (!Array.isArray(claim.sources) || !claim.sources.length || claim.sources.length > 5) throw new Error("research source limit");
    sourceCount += claim.sources.length;
    if (sourceCount > 40) throw new Error("research total source limit");
    const urls = new Set<string>();
    for (const source of claim.sources) {
      const url = researchUrl(source.url, input.allowedOrigins).href;
      if (urls.has(url)) throw new Error("duplicate research source");
      urls.add(url);
    }
    if (claim.maxAgeMs !== undefined && (!Number.isSafeInteger(claim.maxAgeMs) || claim.maxAgeMs <= 0 || !validField(claim.publishedAtField ?? ""))) throw new Error("invalid freshness requirement");
  }
  const totalTimeoutMs = boundedInteger(input.totalTimeoutMs, 30_000, 30_000);
  const maxTotalBytes = boundedInteger(input.maxTotalBytes, 8_000_000, 8_000_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("research total deadline exceeded")), totalTimeoutMs);
  const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
  const evidence: ResearchFetchEvidence[] = [];
  const claims: FactClaim[] = [];
  let totalBytes = 0;
  try {
    for (const spec of input.claims) {
      const sources: FactSource[] = [];
      for (const source of spec.sources) {
        if (totalBytes >= maxTotalBytes) throw new Error("research total byte limit");
        const result = await readResearchSource(source.url, { ...input, signal, maxBytes: Math.min(boundedInteger(input.maxBytes, 2_000_000, 2_000_000), maxTotalBytes - totalBytes) });
        totalBytes += result.bytes.byteLength;
        if (result.contentType !== "application/json") throw new Error("research requires JSON source");
        const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.bytes));
        if (!body || Array.isArray(body) || typeof body !== "object" || !Object.hasOwn(body, spec.jsonField)) throw new Error("missing JSON field or invalid object");
        const value = (body as Record<string, unknown>)[spec.jsonField];
        assertFiniteJson(value);
        const retrievedAt = (input.now?.() ?? new Date()).toISOString();
        let publishedAt: string | undefined;
        if (spec.maxAgeMs !== undefined) {
          const stamp = Object.hasOwn(body, spec.publishedAtField!) ? (body as Record<string, unknown>)[spec.publishedAtField!] : undefined;
          const time = typeof stamp === "string" && /^\d{4}-\d{2}-\d{2}T/.test(stamp) ? Date.parse(stamp) : NaN;
          const age = Date.parse(retrievedAt) - time;
          if (!Number.isFinite(time) || age < 0 || age > spec.maxAgeMs) throw new Error("research source is stale or has invalid publication time");
          publishedAt = new Date(time).toISOString();
        }
        const sourceClass = input.classify?.(result.url) ?? "other";
        if (!["primary_original", "official", "reliable_secondary", "other"].includes(sourceClass)) throw new Error("invalid trusted source class");
        const sha256 = createHash("sha256").update(result.bytes).digest("hex");
        evidence.push({ claimId: spec.id, url: result.url.href, retrievedAt, sha256, sourceClass, publishedAt });
        sources.push({ id: result.url.href, sourceClass, retrievedAt, publishedAt, value });
      }
      claims.push({ id: spec.id, value: spec.value, required: spec.required, status: "UNVERIFIED", sources });
    }
    const verification = verifyFacts(claims);
    // Agreement is insufficient when the host has not established source authority.
    for (const claim of verification.claims) {
      if (claim.status === "CONFIRMED" && !claim.sources.some(s => s.sourceClass !== "other")) claim.status = "UNVERIFIED";
    }
    verification.blocked = verification.claims.filter(c => c.required && c.status !== "CONFIRMED").map(c => c.id);
    verification.ok = verification.blocked.length === 0;
    return { verification, evidence };
  } finally { clearTimeout(timer); controller.abort(); }
}
