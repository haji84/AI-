import { assertCognitiveSafe, cognitiveDigest, type CognitivePartition } from "./cognitive-state.ts";

/** Host-owned provenance/exclusion only; never an execution or promotion authority. */
export interface CognitiveEvaluationPlan {
  version: 1; id: string; partition: CognitivePartition; goalId: string; goalDigest: string;
  environment: string; contractDigest: string; materialSha256: string[];
  actions: Array<{ actionId: string; fingerprint: string }>;
  oracle: "local-source-derived-exact-v1";
}
export interface EvaluationArtifactCheck {
  domain: "file" | "spreadsheet" | "document"; status: "PASS" | "FAIL";
  expectedSha256: string; actualSha256?: string;
  checks: { persisted: boolean; hash: boolean; semantic: boolean };
}
export interface CognitiveEvaluationMeasurement {
  planDigest: string; actionFingerprint: string; verificationDigest: string;
  resultOk: boolean; verifierOk: boolean; artifacts: EvaluationArtifactCheck[];
}
function shape(value: unknown, keys: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || keys.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...keys, ...optional].includes(k))) throw Error("Invalid evaluation schema");
}
function text(value: unknown) { if (typeof value !== "string" || !value.trim() || value.length > 200) throw Error("Invalid evaluation identity"); }
export function evaluationDigest(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw Error("Invalid evaluation digest"); }
export function validateMaterialHashes(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || !value.length || value.length > 24 || new Set(value).size !== value.length) throw Error("Invalid evaluation material hashes");
  value.forEach(evaluationDigest);
}
export function validateEvaluationPlan(value: CognitiveEvaluationPlan): CognitiveEvaluationPlan {
  assertCognitiveSafe(value);
  shape(value, ["version", "id", "partition", "goalId", "goalDigest", "environment", "contractDigest", "materialSha256", "actions", "oracle"]);
  shape(value.partition, ["tenantId", "principalId"]);
  [value.id, value.goalId, value.environment, value.partition.tenantId, value.partition.principalId].forEach(text);
  [value.goalDigest, value.contractDigest].forEach(evaluationDigest); validateMaterialHashes(value.materialSha256);
  if (value.version !== 1 || value.oracle !== "local-source-derived-exact-v1" || !Array.isArray(value.actions) || !value.actions.length || value.actions.length > 32) throw Error("Invalid evaluation oracle/actions");
  for (const action of value.actions) { shape(action, ["actionId", "fingerprint"]); text(action.actionId); evaluationDigest(action.fingerprint); }
  if (new Set(value.actions.map(a => a.actionId)).size !== value.actions.length) throw Error("Duplicate evaluation action");
  return structuredClone(value);
}
function measurementDigest(value: Pick<CognitiveEvaluationMeasurement, "resultOk" | "verifierOk" | "artifacts">) {
  return cognitiveDigest({ resultOk: value.resultOk, verifierOk: value.verifierOk, artifacts: value.artifacts });
}
export function validateEvaluationMeasurement(value: CognitiveEvaluationMeasurement) {
  shape(value, ["planDigest", "actionFingerprint", "verificationDigest", "resultOk", "verifierOk", "artifacts"]);
  [value.planDigest, value.actionFingerprint, value.verificationDigest].forEach(evaluationDigest);
  if (typeof value.resultOk !== "boolean" || typeof value.verifierOk !== "boolean" || !Array.isArray(value.artifacts) || !value.artifacts.length || value.artifacts.length > 2) throw Error("Invalid evaluation measurement");
  for (const artifact of value.artifacts) {
    shape(artifact, ["domain", "status", "expectedSha256", "checks"], ["actualSha256"]);
    evaluationDigest(artifact.expectedSha256); if (artifact.actualSha256 !== undefined) evaluationDigest(artifact.actualSha256);
    shape(artifact.checks, ["persisted", "hash", "semantic"]);
    if (!["file", "spreadsheet", "document"].includes(artifact.domain) || !["PASS", "FAIL"].includes(artifact.status) || Object.values(artifact.checks).some(v => typeof v !== "boolean")) throw Error("Invalid evaluation artifact checks");
    const pass = artifact.checks.persisted && artifact.checks.hash && artifact.checks.semantic;
    if ((artifact.status === "PASS") !== pass || artifact.checks.hash && artifact.actualSha256 !== artifact.expectedSha256) throw Error("Evaluation artifact check disagreement");
  }
  if (value.verifierOk && value.artifacts.some(a => a.status !== "PASS") || value.verificationDigest !== measurementDigest(value)) throw Error("Evaluation measurement digest disagreement");
}
/** Strip paths/raw material; retain independently measured hashes/checks and outcome. */
export function createEvaluationMeasurement(plan: CognitiveEvaluationPlan, actionFingerprint: string, resultOk: boolean, verification: { ok: boolean; evidence?: unknown }): CognitiveEvaluationMeasurement {
  const raw = (verification.evidence as { measurements?: unknown })?.measurements;
  if (!Array.isArray(raw)) throw Error("Evaluation requires actual local oracle measurements");
  const artifacts: EvaluationArtifactCheck[] = raw.map(a => ({ domain: a.domain, status: a.status, expectedSha256: a.expectedSha256,
    ...(a.actualSha256 !== undefined ? { actualSha256: a.actualSha256 } : {}), checks: { persisted: a.checks?.persisted, hash: a.checks?.hash, semantic: a.checks?.semantic } }));
  const measured = { resultOk, verifierOk: verification.ok, artifacts };
  const value = { planDigest: evaluationPlanDigest(plan), actionFingerprint, verificationDigest: measurementDigest(measured), ...measured };
  validateEvaluationMeasurement(value);
  if (!plan.materialSha256.includes(artifacts[0].expectedSha256)) throw Error("Evaluation source measurement binding invalid");
  return value;
}
export function evaluationPlanDigest(plan: CognitiveEvaluationPlan) { return cognitiveDigest(validateEvaluationPlan(plan)); }
