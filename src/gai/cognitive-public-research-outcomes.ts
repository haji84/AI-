import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, resolve, win32 } from "node:path";
import { LocalFileCapability } from "../orchestrator/local-file-capability.ts";
import { readResearchSource, type ResearchTransportOptions } from "../orchestrator/research-transport.ts";
import { sourcePolicy, type SourcePolicy } from "../orchestrator/research-delegation.ts";
import type { ActionResult, Goal, ProposedAction, Verifier } from "../orchestrator/goal-loop.ts";
import type { CapabilityRegistry } from "../orchestrator/capabilities.ts";
import type { WorkStateAction } from "../orchestrator/work-state-integration.ts";
import type { CognitiveCandidate } from "./cognitive-core.ts";
import type { DefinitionOfDoneResult } from "../orchestrator/work-state.ts";
import { assertCognitiveSafe, cognitiveDigest } from "./cognitive-state.ts";
import { boundedRead, containedFile } from "./cognitive-local-outcomes.ts";

export interface CognitivePublicResearchManifest {
  version: 1; goalId: string; goalDigest: string;
  sources: Array<{ id: string; url: string }>;
  outcomes: Array<{ id: string; sourceId: string; fields: Array<{ jsonField: string; label: string }>;
    csvPath: string; memoPath: string; criteria: string[]; publishedAtField?: string }>;
}
export interface CognitivePublicResearchOptions {
  sourcePolicyJson?: string;
  transport?: Pick<ResearchTransportOptions, "resolve" | "fetchImpl" | "maxBytes" | "timeoutMs">;
}
type Outcome = CognitivePublicResearchManifest["outcomes"][number];
type Scalar = string | number | boolean | null;
interface Snapshot {
  url: string; sourceClass: SourcePolicy["sourceClass"]; responseSha256: string;
  retrievedAt: string; observedAt: string; retrievalTimestampTrust: "observed" | "canonical";
  observedResponseSha256?: string;
  values: Array<{ jsonField: string; label: string; value: Scalar }>;
}
interface CanonicalReceipt {
  version: 1; outcomeId: string; actionId: string; actionFingerprint: string;
  goalDigest: string; contractDigest: string;
  source: { url: string; sourceClass: SourcePolicy["sourceClass"]; responseSha256: string; retrievedAt: string };
  artifacts: Array<{ path: string; sha256: string }>;
}
const EVIDENCE_KIND = "public-research-artifact-verification-v1";
const CAPABILITY = "cognitive.public-research", MAX_OUTPUT = 131072;
const HEADERS = ["field", "label", "type", "value", "source_url", "retrieved_at_utc", "response_sha256", "contract_digest"];
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function shape(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !fields.includes(key))) throw Error("Invalid public research schema");
}
function unsafeControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 8 || code >= 11 && code <= 31 || code === 127) return true;
  }
  return false;
}
function text(value: unknown, maximum: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || !value.isWellFormed() || unsafeControl(value)) throw Error("Invalid research text");
}
function id(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/.test(value)) throw Error("Invalid research ID"); }
function path(value: unknown): string {
  text(value, 512);
  if (isAbsolute(value) || win32.isAbsolute(value) || /[:<>"|?*]/.test(value)) throw Error("Research output outside data scope");
  const parts = value.split(/[\\/]/);
  if (parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(?:\.git|\.codex|\.ssh|\.env.*|credentials?|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error("Unsafe research output path");
  return parts.join("/");
}
function fingerprint(action: ProposedAction): string {
  const copy = { ...action } as WorkStateAction; delete copy.workItemId; delete copy.completesWorkItem;
  return cognitiveDigest(copy);
}
function csvCell(value: string): string {
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
function markdown(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&").replace(/\r\n|\r|\n/g, "<br>");
}
function strictTimestamp(value: string): boolean {
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value && Date.parse(value) <= Date.now();
}
function publicationTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number), date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0);
  const zone = match[7];
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second
    && (zone === "Z" || Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59);
}
function finiteJson(body: unknown): void {
  const stack: Array<[unknown, number]> = [[body, 0]]; let nodes = 0;
  while (stack.length) {
    const [value, depth] = stack.pop()!;
    if (++nodes > 10000 || depth > 24 || typeof value === "number" && !Number.isFinite(value)) throw Error("Research JSON complexity bound");
    if (value && typeof value === "object") for (const child of Object.values(value)) stack.push([child, depth + 1]);
  }
}

/** Host-admitted catalog only. Model selections contain an operation ID, never
 * URLs, fields, values, output paths, policy, acknowledgements or credentials. */
export class CognitivePublicResearchOutcomeCatalog {
  readonly contractDigest: string;
  readonly evaluationGoalDigest: string;
  readonly #root: string;
  readonly #manifest: CognitivePublicResearchManifest;
  readonly #policy: SourcePolicy[];
  readonly #transport: CognitivePublicResearchOptions["transport"];
  readonly #snapshots = new Map<string, Snapshot>();
  readonly #receipts = new WeakMap<ActionResult, { binding: string; digest: string; snapshot: Snapshot }>();
  readonly #verified = new Set<string>();
  readonly #canonical = new Map<string, CanonicalReceipt>();
  #completionEvidence: unknown[] = [];
  constructor(root: string, manifest: CognitivePublicResearchManifest, goalId: string, goal: Goal, options: CognitivePublicResearchOptions = {}) {
    this.#root = resolve(root); this.evaluationGoalDigest = cognitiveDigest(goal);
    assertCognitiveSafe(manifest); shape(manifest, ["version", "goalId", "goalDigest", "sources", "outcomes"]);
    if (manifest.version !== 1 || manifest.goalId !== goalId || manifest.goalDigest !== this.evaluationGoalDigest || !Array.isArray(manifest.sources)
      || !manifest.sources.length || manifest.sources.length > 8 || !Array.isArray(manifest.outcomes) || !manifest.outcomes.length || manifest.outcomes.length > 8) throw Error("Invalid research Goal or scope");
    this.#policy = sourcePolicy(options.sourcePolicyJson).map(source => ({ ...source, fields: [...source.fields] }));
    this.#transport = { ...options.transport };
    const ids = new Set<string>(), paths = new Set<string>(); let fields = 0;
    for (const source of manifest.sources) {
      shape(source, ["id", "url"]); id(source.id); text(source.url, 4096);
      if (ids.has(source.id) || !this.#policy.some(policy => policy.url === source.url)) throw Error("Research source not admitted"); ids.add(source.id);
    }
    ids.clear();
    for (const outcome of manifest.outcomes) {
      shape(outcome, ["id", "sourceId", "fields", "csvPath", "memoPath", "criteria", "publishedAtField"]); id(outcome.id);
      const source = manifest.sources.find(source => source.id === outcome.sourceId), policy = this.#policy.find(policy => policy.url === source?.url);
      if (!policy || ids.has(outcome.id) || !Array.isArray(outcome.fields) || !outcome.fields.length || outcome.fields.length > 24) throw Error("Invalid research outcome");
      ids.add(outcome.id); const selected = new Set<string>();
      for (const field of outcome.fields) {
        shape(field, ["jsonField", "label"]); text(field.jsonField, 128); text(field.label, 120);
        if (!policy.fields.includes(field.jsonField) || selected.has(field.jsonField)) throw Error("Research field not admitted"); selected.add(field.jsonField);
      }
      fields += selected.size;
      if (fields > 64 || outcome.publishedAtField !== undefined && !selected.has(outcome.publishedAtField)) throw Error("Research field bound");
      for (const [file, extension] of [[outcome.csvPath, ".csv"], [outcome.memoPath, ".md"]]) {
        const safe = path(file); if (!safe.endsWith(extension) || paths.has(safe.toLowerCase())) throw Error("Invalid or overlapping research output"); paths.add(safe.toLowerCase());
      }
      if (!Array.isArray(outcome.criteria) || !outcome.criteria.length || outcome.criteria.length > 24 || new Set(outcome.criteria).size !== outcome.criteria.length
        || outcome.criteria.some(criterion => !goal.successCriteria.some((_, index) => criterion === `criterion-${index + 1}`))) throw Error("Unknown research criterion");
    }
    this.#manifest = globalThis.structuredClone(manifest);
    this.contractDigest = cognitiveDigest({ root: this.#root, manifest: this.#manifest, policy: this.#policy, transportLimits: { maxBytes: this.#transport.maxBytes, timeoutMs: this.#transport.timeoutMs } });
  }
  #candidate(outcome: Outcome): CognitiveCandidate {
    const actionId = "public-research:" + cognitiveDigest({ contractDigest: this.contractDigest, outcomeId: outcome.id });
    const action: WorkStateAction = { id: actionId, capability: CAPABILITY, description: `Acquire admitted public fields for ${outcome.id} and save CSV and memo`,
      risk: "low", irreversible: false, externalSideEffect: false, materialMutation: true, completesBoundedCommand: false,
      satisfiesDefinitionOfDone: [...outcome.criteria], input: { outcomeId: outcome.id } };
    return { id: actionId, kind: "research", action, expectedOutcome: "Acquired public fields saved with source provenance and independently verified",
      evidenceRequired: ["independent-public-research-artifact-verifier"] };
  }
  async candidates(completedIds: string[] = []): Promise<CognitiveCandidate[]> { return this.#manifest.outcomes.map(outcome => this.#candidate(outcome)).filter(candidate => !completedIds.includes(candidate.id)); }
  completionSatisfied(completedIds: string[]): boolean { return this.#manifest.outcomes.every(outcome => completedIds.includes(this.#candidate(outcome).id) && this.#verified.has(outcome.id)); }
  evaluationDescriptor() { return { materialSha256: [] as string[], candidates: this.#manifest.outcomes.map(outcome => this.#candidate(outcome)) }; }
  skillEvaluationDescriptor(): never { throw Error("Public research benchmark evaluation is unsupported"); }
  assertEvaluationPristine(): never { throw Error("Public research benchmark evaluation is unsupported"); }
  evaluationDataRoot(): never { throw Error("Public research benchmark evaluation is unsupported"); }
  completionEvidence(): unknown { return globalThis.structuredClone(this.#completionEvidence); }
  #receipt(outcome: Outcome, snapshot: Snapshot): CanonicalReceipt {
    const candidate = this.#candidate(outcome);
    return { version: 1, outcomeId: outcome.id, actionId: candidate.id, actionFingerprint: fingerprint(candidate.action),
      goalDigest: this.evaluationGoalDigest, contractDigest: this.contractDigest,
      source: { url: snapshot.url, sourceClass: snapshot.sourceClass, responseSha256: snapshot.responseSha256, retrievedAt: snapshot.retrievedAt },
      artifacts: this.#render(snapshot, outcome).map(artifact => ({ path: artifact.path, sha256: sha(artifact.text) })) };
  }
  /** Arguments come only from the same Goal's canonical WorkState reader, never
   * from model/HTTP/artifact data. Digests detect damage, not owner authentication. */
  #canonicalReceipts(results: readonly DefinitionOfDoneResult[]): Map<string, CanonicalReceipt> {
    const receipts = new Map<string, CanonicalReceipt>();
    if (!Array.isArray(results) || results.length > 256) throw Error("Invalid canonical research evidence");
    for (const result of results) {
      if (result.passed !== true || !result.evidence || typeof result.evidence !== "object") continue;
      const evidence = result.evidence as Record<string, unknown>;
      if (evidence.kind !== EVIDENCE_KIND) continue;
      if (evidence.ok !== true || !this.#manifest.outcomes.some(outcome => outcome.criteria.includes(result.itemId))
        || evidence.goalDigest !== this.evaluationGoalDigest || evidence.contractDigest !== this.contractDigest || !Array.isArray(evidence.receipts)
        || !evidence.receipts.length || evidence.receipts.length > this.#manifest.outcomes.length || Buffer.byteLength(JSON.stringify(evidence)) > 65536) throw Error("Canonical research contract mismatch");
      const { refs, ...body } = evidence;
      if (!Array.isArray(refs) || refs.length !== 1 || refs[0] !== "public-research-verification:" + cognitiveDigest(body)) throw Error("Canonical research evidence damaged");
      for (const value of evidence.receipts) {
        shape(value, ["version", "outcomeId", "actionId", "actionFingerprint", "goalDigest", "contractDigest", "source", "artifacts"]);
        const outcome = this.#manifest.outcomes.find(item => item.id === value.outcomeId), candidate = outcome ? this.#candidate(outcome) : undefined;
        if (!outcome || !candidate || value.version !== 1 || value.actionId !== candidate.id || value.actionFingerprint !== fingerprint(candidate.action)
          || value.goalDigest !== this.evaluationGoalDigest || value.contractDigest !== this.contractDigest) throw Error("Canonical research action mismatch");
        shape(value.source, ["url", "sourceClass", "responseSha256", "retrievedAt"]);
        const source = this.#manifest.sources.find(item => item.id === outcome.sourceId)!, policy = this.#policy.find(item => item.url === source.url)!;
        if (value.source.url !== source.url || value.source.sourceClass !== policy.sourceClass || typeof value.source.responseSha256 !== "string"
          || !/^[a-f0-9]{64}$/.test(value.source.responseSha256) || typeof value.source.retrievedAt !== "string" || !strictTimestamp(value.source.retrievedAt)) throw Error("Canonical research provenance mismatch");
        if (!Array.isArray(value.artifacts) || value.artifacts.length !== 2) throw Error("Canonical research artifact bound");
        for (const [index, artifact] of value.artifacts.entries()) {
          shape(artifact, ["path", "sha256"]);
          if (artifact.path !== [outcome.csvPath, outcome.memoPath][index] || typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw Error("Canonical research artifact mismatch");
        }
        const receipt = value as unknown as CanonicalReceipt, prior = receipts.get(outcome.id);
        if (prior && cognitiveDigest(prior) !== cognitiveDigest(receipt)) throw Error("Conflicting canonical research receipts");
        receipts.set(outcome.id, globalThis.structuredClone(receipt));
      }
    }
    return receipts;
  }
  #binding(action: ProposedAction): Outcome {
    const outcome = this.#manifest.outcomes.find(outcome => this.#candidate(outcome).id === action.id);
    if (!outcome || fingerprint(action) !== fingerprint(this.#candidate(outcome).action)) throw Error("Research action binding mismatch");
    return outcome;
  }
  async #inspect(file: string, absent = false): Promise<Buffer | null> {
    const root = await lstat(this.#root); if (!root.isDirectory() || root.isSymbolicLink()) throw Error("Unsafe research data root");
    const parts = path(file).split("/"); let target = this.#root;
    for (const [index, part] of parts.entries()) {
      target = resolve(target, part);
      const info = await lstat(target).catch(error => { if (absent && (error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
      if (!info) return null;
      if (info.isSymbolicLink() || (index < parts.length - 1 ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size > MAX_OUTPUT)) throw Error("Unsafe research artifact");
    }
    return boundedRead(await containedFile(this.#root, file), MAX_OUTPUT);
  }
  async #acquire(outcome: Outcome): Promise<Snapshot> {
    const source = this.#manifest.sources.find(source => source.id === outcome.sourceId)!, policy = this.#policy.find(policy => policy.url === source.url)!;
    const response = await readResearchSource(source.url, { ...this.#transport, allowedOrigins: [new URL(source.url).origin], accept: "application/json" });
    if (response.contentType !== "application/json") throw Error("Research requires JSON");
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.bytes)); finiteJson(body);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Research requires top-level object");
    const values = outcome.fields.map(field => {
      if (!Object.hasOwn(body, field.jsonField)) throw Error("Research field missing");
      const value = (body as Record<string, unknown>)[field.jsonField];
      if (typeof value === "string") { if (value.length > 4096 || Buffer.byteLength(value) > 8192 || !value.isWellFormed() || unsafeControl(value)) throw Error("Research string bound"); }
      else if (value !== null && typeof value !== "boolean" && (typeof value !== "number" || !Number.isFinite(value))) throw Error("Research requires scalar fields");
      return { ...field, value: value as Scalar };
    });
    assertCognitiveSafe(values);
    const retrievedAt = new Date().toISOString();
    if (outcome.publishedAtField) {
      const value = values.find(value => value.jsonField === outcome.publishedAtField)!.value;
      if (typeof value !== "string" || !publicationTimestamp(value) || Date.parse(value) > Date.parse(retrievedAt)) throw Error("Invalid publication time");
    }
    return { url: response.url.href, sourceClass: policy.sourceClass, responseSha256: sha(response.bytes), retrievedAt, observedAt: retrievedAt, retrievalTimestampTrust: "observed", values };
  }
  #render(snapshot: Snapshot, outcome: Outcome): Array<{ path: string; text: string }> {
    const rows = snapshot.values.map(field => [field.jsonField, field.label, field.value === null ? "null" : typeof field.value, String(field.value), snapshot.url, snapshot.retrievedAt, snapshot.responseSha256, this.contractDigest]);
    const csv = [HEADERS, ...rows].map(row => row.map(csvCell).join(",")).join("\n") + "\n";
    const memo = ["# Public research verification memo", "", `Source: <${snapshot.url}>`, `Source class: ${snapshot.sourceClass}`,
      `Retrieval UTC: ${snapshot.retrievedAt}`, `Response SHA-256: ${snapshot.responseSha256}`, `Contract SHA-256: ${this.contractDigest}`, "",
      "| Field | Label | Type | Retrieved value |", "| --- | --- | --- | --- |",
      ...snapshot.values.map(field => `| ${[field.jsonField, field.label, field.value === null ? "null" : typeof field.value, String(field.value)].map(markdown).join(" | ")} |`), ""].join("\n");
    const artifacts = [{ path: outcome.csvPath, text: csv }, { path: outcome.memoPath, text: memo }];
    if (artifacts.some(artifact => Buffer.byteLength(artifact.text) > MAX_OUTPUT)) throw Error("Research output bound");
    return artifacts;
  }
  async #verifyArtifacts(snapshot: Snapshot, outcome: Outcome) {
    const checks = [];
    for (const artifact of this.#render(snapshot, outcome)) {
      const actual = await this.#inspect(artifact.path);
      const ok = Boolean(actual?.equals(Buffer.from(artifact.text)));
      checks.push({ path: artifact.path, expectedSha256: sha(artifact.text), actualSha256: actual ? sha(actual) : null, semantic: ok });
    }
    return { ok: checks.every(check => check.semantic), source: { url: snapshot.url, sourceClass: snapshot.sourceClass, responseSha256: snapshot.responseSha256,
      retrievedAt: snapshot.retrievedAt, retrievalTimestampTrust: snapshot.retrievalTimestampTrust,
      observedResponseSha256: snapshot.observedResponseSha256 ?? snapshot.responseSha256, observedAt: snapshot.observedAt, revalidatedAt: new Date().toISOString() }, checks };
  }
  register(registry: CapabilityRegistry): void {
    registry.register({ name: CAPABILITY, execute: async action => {
      try {
        const outcome = this.#binding(action), binding = fingerprint(action);
        for (const file of [outcome.csvPath, outcome.memoPath]) await this.#inspect(file, true);
        const snapshot = this.#snapshots.get(outcome.id) ?? await this.#acquire(outcome);
        this.#binding(action); this.#snapshots.set(outcome.id, snapshot);
        const artifacts = this.#render(snapshot, outcome);
        for (const artifact of artifacts) { const existing = await this.#inspect(artifact.path, true); if (existing && !existing.equals(Buffer.from(artifact.text))) throw Error("Research output conflicts"); }
        for (const artifact of artifacts) {
          this.#binding(action);
          if ((await new LocalFileCapability(this.#root).createBytes(artifact.path, Buffer.from(artifact.text))).status === "blocked") throw Error("Research output blocked");
        }
        const result: ActionResult = { actionId: action.id, ok: true, summary: "Public research artifacts saved for independent verification",
          evidence: { refs: ["public-research-acquisition:" + cognitiveDigest({ binding, responseSha256: snapshot.responseSha256, retrievedAt: snapshot.retrievedAt })] } };
        this.#receipts.set(result, { binding, digest: cognitiveDigest(result), snapshot }); return result;
      } catch { return { actionId: action.id, ok: false, summary: "Public research acquisition or artifact policy checks failed", blocker: "public_research_unavailable" }; }
    } });
  }
  verifier(fallback: Verifier, measureFailures = false): Verifier {
    if (measureFailures) throw Error("Public research benchmark evaluation is unsupported");
    return { verify: async input => {
      if (input.action.capability !== CAPABILITY) return fallback.verify(input);
      try {
        const outcome = this.#binding(input.action), receipt = this.#receipts.get(input.result);
        if (!receipt || !input.result.ok || receipt.binding !== fingerprint(input.action) || receipt.digest !== cognitiveDigest(input.result) || cognitiveDigest(input.goal) !== this.evaluationGoalDigest) throw Error("Research result receipt mismatch");
        const evidence = await this.#verifyArtifacts(receipt.snapshot, outcome);
        if (evidence.ok) { this.#verified.add(outcome.id); this.#canonical.set(outcome.id, this.#receipt(outcome, receipt.snapshot)); }
        else { this.#verified.delete(outcome.id); this.#canonical.delete(outcome.id); this.#snapshots.delete(outcome.id); }
        const boundEvidence = { ...evidence, kind: EVIDENCE_KIND, goalDigest: this.evaluationGoalDigest, contractDigest: this.contractDigest,
          receipts: globalThis.structuredClone([...this.#canonical.values()]) };
        return { ok: evidence.ok, summary: evidence.ok ? "Acquired public projection and persisted artifacts independently verified" : "Public research artifacts did not match acquired projection",
          evidence: { ...boundEvidence, refs: evidence.ok ? ["public-research-verification:" + cognitiveDigest(boundEvidence)] : [] } };
      } catch { return { ok: false, summary: "Public research independent verification failed", evidence: { refs: [], blocker: "public_research_verification_failed" } }; }
    } };
  }
  /** Current fields are acquired afresh; original provenance and immutable
   * output hashes come only from the same Goal's canonical verifier record. */
  async revalidateCompleted(completedIds: string[], canonicalResults: readonly DefinitionOfDoneResult[] = []): Promise<boolean> {
    this.#completionEvidence = [];
    const requested = new Set(completedIds);
    if (completedIds.some(id => !this.#manifest.outcomes.some(outcome => this.#candidate(outcome).id === id))) { this.#verified.clear(); this.#canonical.clear(); this.#snapshots.clear(); return false; }
    let canonical: Map<string, CanonicalReceipt>;
    try { canonical = this.#canonicalReceipts(canonicalResults); } catch { this.#verified.clear(); this.#canonical.clear(); this.#snapshots.clear(); return false; }
    for (const outcome of this.#manifest.outcomes.filter(outcome => requested.has(this.#candidate(outcome).id))) {
      try {
        let snapshot = this.#snapshots.get(outcome.id);
        if (!snapshot) {
          const receipt = canonical.get(outcome.id); if (!receipt) throw Error("Canonical research receipt required");
          const observed = await this.#acquire(outcome);
          snapshot = { ...observed, responseSha256: receipt.source.responseSha256, observedResponseSha256: observed.responseSha256,
            retrievedAt: receipt.source.retrievedAt, retrievalTimestampTrust: "canonical" };
          if (cognitiveDigest(this.#receipt(outcome, snapshot)) !== cognitiveDigest(receipt)) throw Error("Approved research fields or immutable artifacts changed");
          this.#canonical.set(outcome.id, receipt);
        }
        const evidence = await this.#verifyArtifacts(snapshot, outcome); this.#completionEvidence.push(evidence);
        if (!evidence.ok) throw Error("Research revalidation mismatch");
        this.#snapshots.set(outcome.id, snapshot); this.#verified.add(outcome.id);
      } catch { this.#verified.delete(outcome.id); this.#canonical.delete(outcome.id); this.#snapshots.delete(outcome.id); return false; }
    }
    return true;
  }
}

/** Only an existing host-configured path is accepted; models/HTTP never choose
 * the manifest, source policy, data root, or transport implementation. */
export async function loadCognitivePublicResearchOutcomes(manifestPath: string, root: string, goalId: string, goal: Goal, options: CognitivePublicResearchOptions = {}) {
  const configured = await lstat(root);
  if (!configured.isDirectory() || configured.isSymbolicLink()) throw Error("Unsafe configured research data root");
  const bytes = await boundedRead(manifestPath, 65536);
  return new CognitivePublicResearchOutcomeCatalog(await realpath(root), JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), goalId, goal, options);
}
