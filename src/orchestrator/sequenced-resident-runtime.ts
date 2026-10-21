import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Goal } from "./goal-loop.ts";
import { createDevelopmentChangeSet } from "./development-change-set.ts";
import { JsonFileDevelopmentChangeSetStore } from "./development-change-set-store.ts";
import { JsonFileDevelopmentJobStore } from "./development-job-store.ts";
import { ResidentDevelopmentGoalHost } from "./resident-development-goal-host.ts";
import { residentDevelopmentSequenceJobId } from "./resident-development-sequence.ts";
import { readResidentExecutionManifest } from "./resident-execution-manifest.ts";
import { readBoundedRuntimeFile } from "./resident-runtime-files.ts";
import { evaluateSignedFileAcceptance } from "./resident-signed-acceptance.ts";
import { createRuntimeBuilderRouter } from "./runtime-builder-capability.ts";
import { localOllamaFixtureTestPath, runLocalTddVerification } from "./local-ollama-tdd.ts";
import { validateSignedLocalVerifierReceipt } from "./signed-local-verifier-receipt.ts";
import { publishResidentVerifierRequest } from "./resident-verifier-request.ts";
import { createPreparedLocalWriteCheckpoint } from "./local-prepared-write.ts";

/** Explicit host-pinned local fixture sequence. No provisioning, publishing or implicit oracle. */
export function createSequencedResidentRuntime(input: {
  env: Record<string, string | undefined>; runtimeRoot: string; compassPath: string; goal: Goal; fetchImpl?: typeof fetch;
}): ResidentDevelopmentGoalHost | null {
  const manifest = readResidentExecutionManifest(input.env, input.runtimeRoot, input.goal);
  if (!manifest) return null;
  if (input.env.GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED !== "1") throw Error("RESIDENT_SEQUENCE_LOCAL_OPT_IN_REQUIRED");
  // This adapter proves bounded local artifacts. Release sequences must use an
  // explicitly configured release adapter; never infer permission from localOnly.
  if (manifest.sequence.completionMode !== "verified-local-artifact") throw Error("RESIDENT_SEQUENCE_RELEASE_ADAPTER_REQUIRED");
  // Include all concrete execution authority in durable IDs. Re-pinning a new
  // oracle, workspace or verifier key cannot inherit old completed Job evidence.
  manifest.sequence = { ...manifest.sequence, executionContractDigest: input.env.GORIQ_SELF_DEVELOPMENT_SEQUENCE_SHA256!.trim() };
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const workspaces = manifest.executions.map(e => e.workspace);
  const runtimes = manifest.executions.map(execution => {
    const key = readBoundedRuntimeFile(execution.publicKeyFile, 8192, workspaces);
    if (hash(key) !== execution.publicKeySha256) throw Error("SIGNED_LOCAL_VERIFIER_PUBLIC_KEY_PIN_MISMATCH");
    return { execution, publicKeyPem: key.toString("utf8") };
  });
  const forJob = (goalId: string, jobId: string) => {
    const runtime = runtimes.find(({ execution }) => residentDevelopmentSequenceJobId(goalId, manifest.sequence, execution.key) === jobId);
    if (!runtime) throw Error("RESIDENT_SEQUENCE_JOB_UNKNOWN");
    return runtime;
  };
  const stateRoot = join(dirname(input.compassPath), "self-development");
  return new ResidentDevelopmentGoalHost({
    jobs: new JsonFileDevelopmentJobStore(join(stateRoot, "jobs.json")),
    changeSets: new JsonFileDevelopmentChangeSetStore(join(stateRoot, "change-sets.json")),
    planning: { requirementIds: ["CORE-014"], baseRevision: manifest.sequence.jobs[0]!.baseRevision,
      taskScopeId: manifest.sequence.taskScopeId, maxRisk: manifest.sequence.maxRisk,
      targetFiles: manifest.sequence.jobs[0]!.targetFiles, contextDigest: manifest.sequence.goalDigest, sequence: manifest.sequence },
    stages: {
      builderId: "local-ollama-builder", deferMissingVerification: true,
      async build({ job, context, workItemId }) {
        const { execution } = forJob(job.goalId, job.jobId);
        const item = job.workItems.find(workItem => workItem.id === workItemId);
        if (!item) throw Error("RESIDENT_SEQUENCE_WORK_ITEM_UNKNOWN");
        const phase = item.id.endsWith(":test") ? "red" : "green";
        const attemptId = `${job.jobId}:attempt:${job.attempts.length + 1}`, strategyId = `${job.jobId}:strategy:${job.attempts.length + 1}`;
        const targetPath = phase === "red" ? localOllamaFixtureTestPath : execution.targetPath;
        const preparedWrite = createPreparedLocalWriteCheckpoint({ stateRoot, workspaces, binding: {
          executionContractDigest: manifest.sequence.executionContractDigest!, goalId: job.goalId, jobId: job.jobId,
          workItemId, attemptId, strategyId, phase, baseRevision: job.baseRevision, workspace: execution.workspace,
          path: targetPath, model: input.env.GAI_LOCAL_MODEL_NAME?.trim() ?? "",
        } });
        const router = createRuntimeBuilderRouter({ ...input.env,
          GORIQ_LOCAL_OLLAMA_BUILDER_ENABLED: "1", GORIQ_LOCAL_OLLAMA_BUILDER_WORKSPACE: execution.workspace,
          GORIQ_LOCAL_OLLAMA_TDD_PROFILE: execution.tddProfile, GORIQ_LOCAL_OLLAMA_ALLOWED_FILES: execution.allowedFiles.join(","),
        }, input.fetchImpl, { preparedWrite });
        const result = await router.execute({ id: `${job.jobId}:build:${phase}`, description: item.objective, capability: "code.builder", risk: "low",
          input: { goalId: job.goalId, attemptId, strategyId,
            objective: item.objective, files: [targetPath], baseRevision: job.baseRevision,
            previousFailureSignatures: job.failureSignatures, previousStrategyFingerprints: job.rejectedStrategyIds, localOnly: true, tddPhase: phase } }, context);
        if (!result.ok) throw Error(result.blocker ?? result.summary);
        const change = (result.evidence as { changeSet?: { baseRevision?: string; changedPaths?: string[]; patchDigest?: string; candidateRevision?: string;
          artifactDigest?: string; artifactRef?: string; tddPhase?: "red" | "green"; tddEvidenceDigest?: string; builderId?: string } } | undefined)?.changeSet;
        if (!change || change.baseRevision !== job.baseRevision || !change.patchDigest) throw Error("RESIDENT_SEQUENCE_CHANGE_SET_INVALID");
        return createDevelopmentChangeSet({ changeSetId: `${job.jobId}:change-set:${phase}`, jobId: job.jobId, workItemId,
          deviceId: change.builderId ?? "local-ollama-builder", baseRevision: job.baseRevision, changedPaths: change.changedPaths ?? [], affectedSymbols: [],
          patchDigest: change.patchDigest, candidateRevision: change.candidateRevision, artifactDigest: change.artifactDigest, artifactRef: change.artifactRef,
          tddPhase: change.tddPhase, tddEvidenceDigest: change.tddEvidenceDigest,
          evidenceDigest: hash(JSON.stringify(result.evidence ?? null)), rollback: { kind: "git-base", reference: job.baseRevision } });
      },
      async verifyRed({ job, changeSet }) {
        const { execution } = forJob(job.goalId, job.jobId);
        const red = runLocalTddVerification(execution.workspace, changeSet.baseRevision, "red");
        if (!red.ok || !red.evidenceDigest || red.evidence?.artifactSha256 !== changeSet.artifactDigest
          || red.evidence.candidateRevision !== changeSet.candidateRevision || changeSet.changedPaths.length !== 1
          || changeSet.changedPaths[0] !== localOllamaFixtureTestPath) throw Error(red.blocker ?? "INDEPENDENT_RED_BINDING_INVALID");
        return { digest: red.evidenceDigest, issuer: red.evidence.verifierId };
      },
      async verify({ job, changeSet, plan }) {
        const { execution, publicKeyPem } = forJob(job.goalId, job.jobId);
        const green = runLocalTddVerification(execution.workspace, changeSet.baseRevision, "green");
        if (!green.ok || green.evidence?.artifactSha256 !== changeSet.artifactDigest || green.evidence.candidateRevision !== plan.sourceRevision) {
          throw Error(green.blocker ?? "INDEPENDENT_GREEN_BINDING_INVALID");
        }
        if (!existsSync(execution.receiptFile)) {
          publishResidentVerifierRequest({ job, changeSet, executionContractDigest: manifest.sequence.executionContractDigest!,
            workspace: execution.workspace, targetPath: execution.targetPath, allowedFiles: execution.allowedFiles,
            receiptFile: execution.receiptFile, workspaces });
          return [];
        }
        const receipt = JSON.parse(readBoundedRuntimeFile(execution.receiptFile, 24576, workspaces).toString("utf8"));
        return validateSignedLocalVerifierReceipt({ receipt, publicKeyPem, plan, changeSet, goalId: job.goalId });
      },
      async acceptanceEvidence({ job, changeSet, plan }) {
        const { execution, publicKeyPem } = forJob(job.goalId, job.jobId);
        return evaluateSignedFileAcceptance({ receiptPath: execution.receiptFile, publicKeyPem, plan, changeSet, goalId: job.goalId,
          workspace: execution.workspace, targetPath: execution.targetPath, allowedFiles: execution.allowedFiles, criteria: job.definitionOfDone, contracts: execution.acceptance });
      },
      async releaseState() {
        // The manifest loader permits only two fixed, new fixture files, and
        // Builder/readback independently fence all other candidate changes.
        return { connected: false, taskScopeId: manifest.sequence.taskScopeId, protectedConditions: [],
          classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true },
          pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null };
      },
    },
  });
}
