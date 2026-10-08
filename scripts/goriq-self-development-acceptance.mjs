import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SelfImprovementRuntime } from "../src/gai/self-improvement-runtime.ts";
import { BuilderRouter } from "../src/orchestrator/builder-router.ts";
import { createDevelopmentChangeSet } from "../src/orchestrator/development-change-set.ts";
import { DevelopmentConflictIntegrator } from "../src/orchestrator/development-conflict-integrator.ts";
import { evaluateDevelopmentReleaseGate } from "../src/orchestrator/development-release-gate.ts";
import { createDevelopmentVerificationPlan } from "../src/orchestrator/development-verification-plan.ts";
import { DeviceDevelopmentIntake, JsonFileDeviceDevelopmentInbox } from "../src/orchestrator/device-development-intake.ts";
import { createTaskCompletionAuthorization } from "../src/orchestrator/task-authorization.ts";

const sha256 = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

function builder(id, kind) {
  return {
    id,
    kind,
    async available() { return true; },
    async build(request) {
      return {
        actionId: request.attemptId,
        ok: true,
        summary: `${kind} Builder completed deterministic fixture`,
        evidence: { builderId: id, builderKind: kind, patchDigest: sha256([id, request.strategyId]) },
      };
    },
  };
}

async function routeBuilder(localOnly) {
  const router = new BuilderRouter([builder("external-fixture", "external"), builder("local-fixture", "local")]);
  return router.execute({
    id: localOnly ? "local-only" : "external-assisted",
    description: "deterministic acceptance fixture",
    capability: "code.builder",
    risk: "low",
    input: {
      goalId: "goal-681",
      attemptId: localOnly ? "attempt-local" : "attempt-external",
      strategyId: localOnly ? "strategy-local" : "strategy-external",
      objective: "verify common Builder routing",
      files: ["src/orchestrator/example.ts"],
      baseRevision: "a".repeat(40),
      localOnly,
    },
  }, []);
}

function change(id, deviceId, patchDigest) {
  return createDevelopmentChangeSet({
    changeSetId: id,
    jobId: "job-681",
    workItemId: "work-681",
    deviceId,
    baseRevision: "a".repeat(40),
    changedPaths: ["src/orchestrator/same.ts"],
    affectedSymbols: ["run"],
    patchDigest,
    evidenceDigest: sha256([id, "evidence"]),
    rollback: { kind: "git-base", reference: "a".repeat(40) },
  }, new Date("2026-09-26T12:00:00.000Z"));
}

async function deviceTopology(recordedAt) {
  const root = await mkdtemp(join(tmpdir(), "goriq-device-intake-"));
  const inboxPath = join(root, "inbox.json");
  const inbox = new JsonFileDeviceDevelopmentInbox(inboxPath);
  const intake = new DeviceDevelopmentIntake({ inbox, async submit() { return { goalId: "goal-681", action: "CONTINUE_GOAL" }; } });
  await intake.receive({
    deviceId: "iphone-1",
    platform: "ios",
    ownerCommandId: "iphone-command-1",
    text: "continue development",
    connectivity: "offline",
    goalSnapshotDigest: sha256("goal-681"),
  }, new Date(recordedAt));
  let secondIphoneRejected = false;
  try {
    await intake.receive({
      deviceId: "iphone-2",
      platform: "ios",
      ownerCommandId: "iphone-command-2",
      text: "continue development",
      connectivity: "offline",
      goalSnapshotDigest: sha256("goal-681"),
    }, new Date(recordedAt));
  } catch (error) {
    secondIphoneRejected = /second iPhone/i.test(error instanceof Error ? error.message : String(error));
  }
  const restored = new JsonFileDeviceDevelopmentInbox(inboxPath);
  const result = { iphoneCount: (await restored.list()).filter((item) => item.platform === "ios").length, secondIphoneRejected, physicalEvidence: null };
  await rm(root, { recursive: true, force: true });
  return result;
}

async function rollbackAcceptance(root) {
  let rollbackCalls = 0;
  const adapters = {
    sandbox: async () => ({ ok: true, evidence: ["sandbox:pass"] }),
    test: async () => ({ ok: true, evidence: ["tests:pass"] }),
    regression: async () => ({ ok: true, evidence: ["regression:pass"] }),
    deviceE2E: async () => ({ ok: true, evidence: ["device:deterministic"] }),
    canary: async () => ({ ok: false, evidence: ["canary:failed"], reason: "canary_regression" }),
    promote: async () => ({ ok: true, evidence: ["promotion:not-reached"] }),
    rollback: async () => { rollbackCalls += 1; return { ok: true, evidence: ["known-good:v1:restored", "restored:verified"] }; },
  };
  const path = join(root, "improvement.json");
  const record = await new SelfImprovementRuntime(path, adapters).run({
    id: "candidate-681",
    surface: "code",
    sourceEvidence: ["verified:change-set"],
    knownGoodVersion: "v1",
    candidateVersion: "v2",
    verified: true,
    measurableGain: 0.1,
    safetyRegression: false,
    humanInterventionDelta: 0,
    additionalApiCostUsd: 0,
  });
  const restarted = await new SelfImprovementRuntime(path, adapters).list();
  return record.state === "rolled-back" && rollbackCalls === 1 && restarted[0]?.state === "rolled-back" && record.evidence.includes("restored:verified");
}

export async function runSelfDevelopmentAcceptance({ mode, sourceRevision, recordedAt }) {
  if (!new Set(["deterministic", "real-local-model", "real-github", "physical-iphone"]).has(mode)) throw new Error(`unsupported acceptance mode: ${mode}`);
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error("exact 40-character source revision is required");
  if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("valid acceptance timestamp is required");
  if (mode !== "deterministic") {
    return {
      schemaVersion: 1, mode, sourceRevision, recordedAt, scenarios: [],
      deviceTopology: { iphoneCount: mode === "physical-iphone" ? 1 : 0, secondIphoneRejected: false, physicalEvidence: null },
      secretScan: { passed: true, findings: [] },
      evidenceClasses: {
        deterministicSimulation: "NOT_RUN",
        realLocalModel: mode === "real-local-model" ? "PENDING_EXTERNAL_EXECUTION" : "NOT_RUN",
        realGitHub: mode === "real-github" ? "PENDING_EXTERNAL_EXECUTION" : "NOT_RUN",
        physicalIphone: mode === "physical-iphone" ? "PENDING_EXTERNAL_EXECUTION" : "NOT_RUN",
      },
    };
  }

  const external = await routeBuilder(false);
  const local = await routeBuilder(true);
  const plan = createDevelopmentVerificationPlan({
    builderId: "local-fixture",
    sourceRevision,
    artifactDigest: sha256("offline-change-set"),
    changedPaths: ["src/orchestrator/example.ts"],
  });
  const authorization = createTaskCompletionAuthorization("Issue #681を完成させて", { now: new Date(recordedAt) });
  const offline = evaluateDevelopmentReleaseGate({
    phase: "READY_TO_PUBLISH",
    connected: false,
    risk: "medium",
    taskScopeId: "issue:681",
    taskAuthorization: authorization,
    changedFiles: plan.changedPaths,
    verificationPlan: plan,
    verificationEvidence: plan.requiredChecks.map((check) => ({ check, verifierId: "verifier:macbook", sourceRevision, artifactDigest: plan.artifactDigest, status: "passed", recordedAt })),
    protectedConditions: [], classifications: { destructiveChangeAbsent: true, privilegedChangeAbsent: true }, pullRequest: null, mainCi: null, deployment: null, postDeploymentEvidence: null,
    now: new Date(recordedAt),
  });
  const integration = await new DevelopmentConflictIntegrator({
    async candidates() {
      return [{ id: "semantic-merge", changedPaths: ["src/orchestrator/same.ts"], patchDigest: sha256("integrated"), satisfiedCriteria: ["preserve-local", "preserve-remote"] }];
    },
  }).integrate({
    local: change("local", "zbook-1", sha256("local")),
    remote: change("remote", "macbook-1", sha256("remote")),
    acceptanceCriteria: ["preserve-local", "preserve-remote"],
    verify: async () => ({ ok: true, evidenceDigest: sha256("integration-evidence") }),
  });
  const root = await mkdtemp(join(tmpdir(), "goriq-acceptance-"));
  let rollbackPassed = false;
  try { rollbackPassed = await rollbackAcceptance(root); } finally { await rm(root, { recursive: true, force: true }); }
  const topology = await deviceTopology(recordedAt);
  const scenarios = [
    { id: "online-external-assisted", status: external.ok && external.evidence?.builderKind === "external" ? "PASS" : "FAIL", artifactDigest: sha256(external.evidence ?? null), environment: "deterministic-simulation", deviceIdentityClass: "external-builder-fixture", checks: ["builder-route-selection", "builder-kind-envelope"] },
    { id: "online-local-only", status: local.ok && local.evidence?.builderKind === "local" ? "PASS" : "FAIL", artifactDigest: sha256(local.evidence ?? null), environment: "deterministic-simulation", deviceIdentityClass: "local-builder-fixture", checks: ["local-only-routing", "external-builder-excluded"] },
    { id: "offline-ready-to-publish", status: offline.action === "READY_TO_PUBLISH" ? "PASS" : "FAIL", artifactDigest: plan.artifactDigest, environment: "deterministic-simulation", deviceIdentityClass: "offline-local-worker-fixture", checks: ["release-gate-offline-decision", "verification-binding"] },
    { id: "reconnect-semantic-integration", status: integration.ok && integration.provenance?.sourceChangeSetIds.length === 2 ? "PASS" : "FAIL", artifactDigest: integration.changeSet?.patchDigest ?? sha256("missing"), environment: "deterministic-simulation", deviceIdentityClass: "zbook-macbook-fixture", checks: ["candidate-contract", "both-source-metadata-provenance", "injected-verifier-result"] },
    { id: "restart-canary-rollback", status: rollbackPassed ? "PASS" : "FAIL", artifactDigest: sha256("known-good:v1"), environment: "deterministic-simulation", deviceIdentityClass: "resident-runtime-fixture", checks: ["persisted-state-reload", "adapter-canary-failure", "adapter-rollback-receipt"] },
  ];
  const result = {
    schemaVersion: 1,
    mode,
    sourceRevision,
    recordedAt,
    scenarios,
    deviceTopology: topology,
    secretScan: { passed: true, findings: [] },
    evidenceClasses: { deterministicSimulation: "PASS", realLocalModel: "NOT_RUN", realGitHub: "NOT_RUN", physicalIphone: "NOT_RUN" },
  };
  const serialized = JSON.stringify(result);
  const secretPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|secret|token|recovery[_ -]?code)\s*[:=]\s*[^\s,;]+/i;
  if (secretPattern.test(serialized) || scenarios.some((scenario) => scenario.status !== "PASS")) throw new Error("deterministic self-development acceptance failed closed");
  return result;
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const self = process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (self) {
  const mode = argument("mode") ?? "deterministic";
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const sourceRevision = argument("source-revision") ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const recordedAt = argument("recorded-at") ?? new Date().toISOString();
  process.stdout.write(`${JSON.stringify(await runSelfDevelopmentAcceptance({ mode, sourceRevision, recordedAt }), null, 2)}\n`);
}
