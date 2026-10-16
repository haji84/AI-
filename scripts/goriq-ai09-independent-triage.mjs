// AI-09 triage-to-repair boundary: proposals only, no task dispatch or write authority.
// The trusted caller must fetch the canonical GitHub patch and supply an independently
// authenticated verifier adapter. Never treat model-provided JSON as that adapter.
import { createHash } from "node:crypto";
import { anchorAudit } from "./goriq-ai09-finding-anchors.mjs";

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REF = /^[A-Za-z0-9_:/.-]{8,128}$/;

export const EVIDENCE_FIRST_MODEL_INSTRUCTIONS = [
  "For a finding, cite exact changed file and added new-side line number.",
  "Quote 12 or more consecutive characters of code from the cited added line.",
  "Explain the concrete bug and a reproducible failure case.",
  "Do not infer defects from generic warnings or a prompt delimiter.",
  "If evidence is uncertain, return INCONCLUSIVE instead of a guessed finding.",
  "These code citations are advisory and do not establish an approved defect.",
].join("\n");

function safePath(path) {
  return typeof path === "string" && path.length > 0 && path.length <= 250 &&
    !path.startsWith("/") && !path.startsWith("-") &&
    !path.includes("\\") && ![...path].some(char => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    }) &&
    path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
function hold(reason) {
  return {
    stage: "IndependentTechnicalTriage", status: "TRIAGE_REQUIRED", reason,
    handoff: null, independentVerificationSatisfied: false,
    correctionTaskCreated: false, builderAcknowledged: false,
    writeAuthorized: false, githubApprovalSatisfied: false, mergeAuthorized: false,
  };
}

// Only a trusted non-model adapter can authenticate a real verifier and the
// independently reproduced failure on the *same* immutable PR revision.
// This function does not execute tests, post comments, create Issues or assign agents.
export async function prepareVerifiedRepairProposal({
  repository, prNumber, review, trustedPatch, findingIndex, verificationRef,
}, authenticateIndependentProof) {
  if (typeof authenticateIndependentProof !== "function")
    return hold("TRUSTED_VERIFIER_ADAPTER_REQUIRED");
  const scope = review?.scope;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
      !Number.isSafeInteger(prNumber) || prNumber < 1 ||
      review?.reviewer !== "AI-09" || review?.evidenceClass !== "AI_ASSERTED" ||
      review?.status !== "CHANGES_REQUESTED" ||
      review?.githubApprovalSatisfied !== false || review?.mergeAuthorized !== false ||
      review?.independentGitHubAccountVerified !== false ||
      !SHA40.test(scope?.headSha ?? "") || !SHA40.test(scope?.baseSha ?? "") ||
      scope.headSha === scope.baseSha || !SHA256.test(scope?.patchSha256 ?? "") ||
      !Array.isArray(scope.paths) || scope.paths.length < 1 || scope.paths.length > 30 ||
      !scope.paths.every(safePath) || !Array.isArray(review.findings) ||
      review.findings.length < 1 || review.findings.length > 20 ||
      !Number.isSafeInteger(findingIndex) || findingIndex < 0 ||
      findingIndex >= review.findings.length ||
      typeof trustedPatch !== "string" || trustedPatch.length === 0 ||
      Buffer.byteLength(trustedPatch, "utf8") > 120 * 1024)
    return hold("INVALID_REVIEW_SCOPE");

  const patchDigest = createHash("sha256").update(trustedPatch).digest("hex");
  if (patchDigest !== scope.patchSha256) return hold("STALE_OR_UNTRUSTED_PATCH");
  const finding = review.findings[findingIndex];
  if (!safePath(finding?.path) || !scope.paths.includes(finding.path) ||
      !Number.isSafeInteger(finding.line) || finding.line < 1 ||
      finding.line > 500000)
    return hold("INVALID_FINDING_LOCATION");
  let anchored;
  try {
    anchored = anchorAudit([finding], trustedPatch).complete;
  } catch {
    return hold("PATCH_ANCHOR_UNVERIFIABLE");
  }
  if (!anchored) return hold("SOURCE_QUOTE_NOT_GROUNDED");
  if (typeof verificationRef !== "string" || !REF.test(verificationRef) ||
      verificationRef.includes(".."))
    return hold("VERIFICATION_REFERENCE_REQUIRED");

  const expected = Object.freeze({
    repository, prNumber, headSha: scope.headSha, baseSha: scope.baseSha,
    patchSha256: patchDigest, path: finding.path, line: finding.line,
    findingIndex,
  });
  // Only the adapter may inspect authenticated, source-bound test/reproduction
  // records; no untrusted model evidence or proposed fix is passed to it.
  let proof;
  try {
    proof = await authenticateIndependentProof({ verificationRef, expected });
  } catch {
    return hold("INDEPENDENT_VERIFIER_UNAVAILABLE");
  }
  const actor = proof?.verifierActor;
  const builder = proof?.builderActor;
  if (proof?.authenticated !== true || proof?.independent !== true ||
      proof?.reproduced !== true || !["MACHINE_VERIFIED", "HUMAN_VERIFIED"].includes(proof?.evidenceClass) ||
      !REF.test(proof?.evidenceId ?? "") || proof.evidenceId !== verificationRef ||
      !SHA256.test(proof?.evidenceSha256 ?? "") ||
      proof?.repository !== repository || proof?.prNumber !== prNumber ||
      proof?.headSha !== scope.headSha || proof?.baseSha !== scope.baseSha ||
      proof?.patchSha256 !== patchDigest ||
      proof?.path !== finding.path || proof?.line !== finding.line ||
      proof?.findingIndex !== findingIndex ||
      typeof actor !== "string" || !REF.test(actor) ||
      typeof builder !== "string" || !REF.test(builder) ||
      actor.toLowerCase() === builder.toLowerCase() ||
      actor.toLowerCase() === "ai-09")
    return hold("INDEPENDENT_REPRODUCTION_NOT_VERIFIED");

  // The proposal contains *no* model-authored free text, shell command,
  // tokens or executable patch. A separate task authority must accept it.
  const taskId = "ai09:pr:" + prNumber + ":" + scope.headSha + ":" + (findingIndex + 1);
  return {
    stage: "IndependentTechnicalTriage", status: "VERIFIED_CANDIDATE",
    reason: "AUTHENTICATED_INDEPENDENT_REPRODUCTION",
    independentVerificationSatisfied: true,
    handoff: {
      TASK_ID: taskId,
      SOURCE_AGENT: "AI-09 Reviewer",
      TARGET_AGENT: "Builder/Debugger",
      STATUS: "PROPOSAL_PENDING_AUTHORITY_AND_ACK",
      OBJECTIVE: "Reproduce and repair a separately verified change-scoped defect",
      SCOPE: { ...expected },
      FILES_ALLOWED: [finding.path],
      FILES_FORBIDDEN: ["all other paths without separate authority"],
      ACCEPTANCE_CRITERIA: [
        "Reproduce the independently recorded failure on this exact head",
        "Make a bounded change inside separately authorized paths",
        "Run tests and independent review on the corrected head",
      ],
      TESTS_REQUIRED: ["Reproduction evidence", "Affected regression suite", "Exact-head CI"],
      RESULT: "UNSTARTED",
      BLOCKERS: ["Independent task authority and receiving-agent acknowledgement required"],
      NEXT_ACTION: "Present this proposal to the governed task authority, never auto-dispatch",
      VERIFIED_EVIDENCE: { id: proof.evidenceId, sha256: proof.evidenceSha256,
        evidenceClass: proof.evidenceClass, verifierActor: actor },
    },
    correctionTaskCreated: false, builderAcknowledged: false,
    writeAuthorized: false, githubApprovalSatisfied: false, mergeAuthorized: false,
  };
}
