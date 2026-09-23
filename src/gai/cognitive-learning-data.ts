import { createHash } from "node:crypto";
import { cognitiveLearningText, type CognitiveLearningEngine, type CognitiveLearningPartition } from "./cognitive-learning.ts";

export type LearningScope = "owner" | "tester-private" | "organization" | "shared-generalized" | "global";
export type LearningClassification = "public" | "internal" | "personal" | "confidential" | "secret";
export type HistoricalSourceKind = "commit" | "issue" | "pull-request" | "diff" | "ci" | "workflow" | "saved-instruction" | "specification" | "project-state" | "decision" | "rollback" | "failure" | "recovery" | "benchmark" | "correction" | "verified-experience";
export interface HistoricalLearningSource {
  id: string; kind: HistoricalSourceKind; sourceRef: string; content: string; sha256: string;
  partition: CognitiveLearningPartition; scope: LearningScope; classification: LearningClassification; familyId: string;
  verification?: { issuer: string; evidenceRefs: string[]; artifactSha256: string; passed: boolean; independent: boolean };
  split?: "train" | "validation" | "heldout";
}
export interface LearningDataCandidate {
  id: string; sourceRef: string; sourceKind: HistoricalSourceKind; content: string; sha256: string;
  partition: CognitiveLearningPartition; scope: LearningScope; classification: LearningClassification; familyId: string;
  status: "UNVERIFIED" | "VERIFIED_CANDIDATE"; evidenceRefs: string[]; split?: "train" | "validation" | "heldout";
}
const sourceKinds = new Set<HistoricalSourceKind>(["commit", "issue", "pull-request", "diff", "ci", "workflow", "saved-instruction", "specification", "project-state", "decision", "rollback", "failure", "recovery", "benchmark", "correction", "verified-experience"]);
const scopes = new Set<LearningScope>(["owner", "tester-private", "organization", "shared-generalized", "global"]);
const classifications = new Set<LearningClassification>(["public", "internal", "personal", "confidential", "secret"]);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function samePartition(a: CognitiveLearningPartition, b: CognitiveLearningPartition): boolean { return a.tenantId === b.tenantId && a.principalId === b.principalId; }
function validatePartition(value: CognitiveLearningPartition): void {
  if (!value || Object.keys(value).some((key) => !["tenantId", "principalId"].includes(key)) || [value.tenantId, value.principalId].some((field) => typeof field !== "string" || !/^[a-zA-Z0-9:_-]{1,128}$/.test(field))) throw Error("Invalid learning data partition");
}

/** Import only supplied artifacts. Missing CI/author/review history is never inferred. */
export function importHistoricalLearning(sources: HistoricalLearningSource[], partition: CognitiveLearningPartition): LearningDataCandidate[] {
  validatePartition(partition);
  if (!Array.isArray(sources) || sources.length > 500) throw Error("Historical learning import limit exceeded");
  const imported = new Map<string, LearningDataCandidate>();
  for (const source of sources) {
    validatePartition(source.partition);
    if (!samePartition(source.partition, partition)) throw Error("Historical source partition mismatch");
    if (!sourceKinds.has(source.kind) || !scopes.has(source.scope) || !classifications.has(source.classification)) throw Error("Invalid historical source metadata");
    if (source.classification !== "public" && source.classification !== "internal") continue;
    const content = cognitiveLearningText(source.content, "historical content", 8_192);
    const id = cognitiveLearningText(source.id, "source ID", 256);
    const sourceRef = cognitiveLearningText(source.sourceRef, "source reference", 512);
    const familyId = cognitiveLearningText(source.familyId, "source family", 256);
    if (!/^[a-f0-9]{64}$/.test(source.sha256) || digest(source.content) !== source.sha256) throw Error("Historical source digest mismatch");
    if (source.split !== undefined && !["train", "validation", "heldout"].includes(source.split)) throw Error("Invalid historical split");
    const verification = source.verification;
    const evidenceRefs = verification?.evidenceRefs ?? [];
    if (!Array.isArray(evidenceRefs) || evidenceRefs.length > 32) throw Error("Historical verification evidence limit");
    for (const ref of evidenceRefs) cognitiveLearningText(ref, "historical evidence", 256);
    if (verification) cognitiveLearningText(verification.issuer, "verification issuer", 256);
    const verified = verification?.passed === true && verification.independent === true && verification.artifactSha256 === source.sha256 && evidenceRefs.length > 0;
    const candidate: LearningDataCandidate = { id, sourceRef, sourceKind: source.kind, content, sha256: digest(content), partition: { ...partition },
      scope: source.scope, classification: source.classification, familyId, status: verified ? "VERIFIED_CANDIDATE" : "UNVERIFIED",
      evidenceRefs: verified ? [...new Set(evidenceRefs)] : [], ...(source.split ? { split: source.split } : {}) };
    const previous = imported.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) throw Error("Historical source ID conflict");
    imported.set(id, candidate);
  }
  return [...imported.values()];
}

export interface TrainingCandidateDataset {
  version: 1; partition: CognitiveLearningPartition; train: LearningDataCandidate[]; validation: LearningDataCandidate[];
  heldout: LearningDataCandidate[]; rejected: Array<{ id: string; reason: string }>; digest: string;
  training: { state: "CANDIDATE_ONLY"; automaticTraining: false; methods: ["fine-tuning", "LoRA"]; gates: string[] };
}

/** Dataset construction is deterministic and local; no training, model promotion or network action. */
export function buildTrainingCandidateDataset(candidates: LearningDataCandidate[], partition: CognitiveLearningPartition): TrainingCandidateDataset {
  validatePartition(partition);
  if (!Array.isArray(candidates) || candidates.length > 500) throw Error("Training dataset limit exceeded");
  const rejected: TrainingCandidateDataset["rejected"] = [];
  const train: LearningDataCandidate[] = []; const validation: LearningDataCandidate[] = []; const heldout: LearningDataCandidate[] = [];
  const seen = new Set<string>();
  // Families connected by duplicate content form one indivisible split group.
  // Resolve the entire graph first: a held-out duplicate may occur after an
  // earlier sibling, or be connected through several renamed families.
  const parents = new Map<string, string>();
  const find = (family: string): string => {
    const parent = parents.get(family);
    if (parent === undefined) { parents.set(family, family); return family; }
    if (parent === family) return family;
    const root = find(parent); parents.set(family, root); return root;
  };
  const digestFamilies = new Map<string, string>();
  for (const item of candidates) {
    const root = find(item.familyId);
    const previous = digestFamilies.get(item.sha256);
    if (previous === undefined) digestFamilies.set(item.sha256, item.familyId);
    else {
      const other = find(previous);
      if (root !== other) parents.set(root < other ? other : root, root < other ? root : other);
    }
  }
  const families = new Map<string, "train" | "validation" | "heldout">();
  for (const item of candidates) {
    const group = find(item.familyId);
    if (item.split === "heldout") families.set(group, "heldout");
    else if (item.split === "validation" && families.get(group) !== "heldout") families.set(group, "validation");
  }
  for (const item of candidates) {
    validatePartition(item.partition);
    if (!samePartition(item.partition, partition)) throw Error("Training candidate partition mismatch");
    if (!scopes.has(item.scope) || !classifications.has(item.classification) || !sourceKinds.has(item.sourceKind) || !Array.isArray(item.evidenceRefs) || item.evidenceRefs.length > 32) throw Error("Invalid training candidate metadata");
    cognitiveLearningText(item.id, "training candidate ID", 256);
    cognitiveLearningText(item.familyId, "training family", 256);
    if (item.status !== "VERIFIED_CANDIDATE" || !item.evidenceRefs?.length) { rejected.push({ id: item.id, reason: "independent_verification_required" }); continue; }
    if (item.classification !== "public" && item.classification !== "internal") { rejected.push({ id: item.id, reason: "privacy_filter" }); continue; }
    cognitiveLearningText(item.content, "training content", 8_192);
    if (digest(item.content) !== item.sha256) throw Error("Training candidate digest mismatch");
    if (seen.has(item.sha256)) { rejected.push({ id: item.id, reason: "duplicate" }); continue; }
    seen.add(item.sha256);
    const group = find(item.familyId);
    const split = families.get(group) ?? (parseInt(digest(group).slice(0, 2), 16) % 5 === 0 ? "validation" : "train");
    const copy: LearningDataCandidate = { id: item.id, sourceRef: cognitiveLearningText(item.sourceRef, "training source", 512), sourceKind: item.sourceKind,
      content: item.content, sha256: item.sha256, partition: { ...partition }, scope: item.scope, classification: item.classification,
      familyId: item.familyId, status: "VERIFIED_CANDIDATE", evidenceRefs: item.evidenceRefs.map((ref) => cognitiveLearningText(ref, "training evidence", 256)), split };
    ({ train, validation, heldout })[split].push(copy);
  }
  return { version: 1, partition: { ...partition }, train, validation, heldout, rejected,
    digest: digest(JSON.stringify({ train: train.map((c) => c.sha256), validation: validation.map((c) => c.sha256), heldout: heldout.map((c) => c.sha256) })),
    training: { state: "CANDIDATE_ONLY", automaticTraining: false, methods: ["fine-tuning", "LoRA"],
      gates: ["resource availability", "license and privacy", "held-out benchmark", "independent verification", "safety", "regression", "baseline and rollback", "governed model promotion"] } };
}

export function promoteGeneralizedKnowledge(candidate: LearningDataCandidate, input: {
  target: "organization" | "shared-generalized" | "global"; generalizedContent: string; privacyPassed: boolean; independent: boolean; evidenceRefs: string[];
}): LearningDataCandidate {
  if (candidate.status !== "VERIFIED_CANDIDATE" || !input.privacyPassed || !input.independent || input.evidenceRefs.length === 0 || input.evidenceRefs.some((ref) => candidate.evidenceRefs.includes(ref))) throw Error("Separate independent privacy/generalization evidence required");
  if (!["organization", "shared-generalized", "global"].includes(input.target)) throw Error("Invalid generalization scope");
  if (input.target !== "organization" && candidate.classification !== "public") throw Error("Only public generalized knowledge can cross organization boundaries");
  const content = cognitiveLearningText(input.generalizedContent, "generalized knowledge", 8_192);
  if ((candidate.scope === "owner" || candidate.scope === "tester-private") && normalized(content) === normalized(candidate.content)) throw Error("Private experience cannot be shared unchanged");
  return { ...candidate, id: `generalized:${digest(content).slice(0, 24)}`, content, sha256: digest(content), scope: input.target,
    evidenceRefs: input.evidenceRefs.map((ref) => cognitiveLearningText(ref, "generalization evidence", 256)) };
}
function normalized(value: string): string { return value.toLowerCase().replace(/\s+/g, " ").trim(); }

/** Connect dataset construction to the same validated, partitioned ledger used by live Core learning. */
export async function prepareCognitiveTrainingDataset(engine: CognitiveLearningEngine, partition: CognitiveLearningPartition, options: { scope?: "owner" | "tester-private" } = {}): Promise<TrainingCandidateDataset> {
  const scope = options.scope ?? "tester-private";
  if (scope !== "owner" && scope !== "tester-private") throw Error("Invalid private training scope");
  const data = await engine.exportVerifiedData(partition);
  const heldoutFamilies = new Set(data.heldoutFamilies.map(({ task, environment }) => digest(`${normalized(task)}|${environment}`)));
  const sources: HistoricalLearningSource[] = data.experiences.map((experience) => {
    const content = JSON.stringify({ task: experience.task, actionId: experience.actionId, strategyId: experience.strategyId,
      expected: experience.prediction.expectedOutcome, observed: experience.observation.summary, environment: experience.environment });
    const sha256 = digest(content);
    return { id: experience.id, kind: "verified-experience", sourceRef: `cognitive:${experience.id}`, content, sha256,
      partition, scope, classification: "internal", familyId: digest(`${normalized(experience.task)}|${experience.environment}`),
      verification: { issuer: "cognitive-independent-observation-verifier", evidenceRefs: experience.evidenceRefs, artifactSha256: sha256, passed: true, independent: true },
      ...(experience.split === "heldout" ? { split: "heldout" as const } : {}) };
  });
  for (const correction of data.corrections) {
    const content = JSON.stringify({ task: correction.task, originalActionId: correction.originalActionId,
      correctedActionId: correction.replacementActionId, environment: correction.environment, ruleScope: correction.scope });
    const sha256 = digest(content);
    sources.push({ id: `correction:${correction.id}`, kind: "correction", sourceRef: `cognitive-correction:${correction.id}`, content, sha256,
      partition, scope, classification: "internal", familyId: digest(`${normalized(correction.task)}|${correction.environment}`),
      verification: { issuer: "cognitive-independent-correction-verifier", evidenceRefs: correction.evidenceRefs, artifactSha256: sha256, passed: true, independent: true } });
  }
  for (const source of sources) if (heldoutFamilies.has(source.familyId)) source.split = "heldout";
  return buildTrainingCandidateDataset(importHistoricalLearning(sources, partition), partition);
}
