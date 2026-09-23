import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { CompassStore } from "../src/compass/store.ts";
import { compassGoalToLoopGoal } from "../src/orchestrator/compass-state-store.ts";
import { goalWorkStateId } from "../src/orchestrator/work-state-integration.ts";
import { CognitiveService } from "../src/gai/cognitive-service.ts";
import { CognitiveStateStore } from "../src/gai/cognitive-state.ts";
import { configuredPrimaryBrain } from "../src/gai/primary-brain.ts";
if (!process.env.GAI_LOCAL_MODEL_NAME?.trim()) throw Error("Specify an already installed GAI_LOCAL_MODEL_NAME; this script never downloads models");
const root = await mkdtemp(join(tmpdir(), "goriq-model-smoke-"));
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error("Unexpected temporary directory");
const started = Date.now();
try {
  const dbPath = join(root, "compass.db"), dataRoot = join(root, "data"), manifestPath = join(root, "manifest.json"), stateRoot = join(root, "cognition");
  await mkdir(dataRoot);
  const compass = new CompassStore(dbPath);
  const record = compass.setGoal({ title: "Create a local result file containing 42", successCriteria: ["result.txt persists exactly the UTF-8 text 42"], constraints: ["No external AI or external network", "Use only the provided host-authorized capability"] });
  const goalId = goalWorkStateId(compassGoalToLoopGoal(record)); compass.close();
  await writeFile(manifestPath, JSON.stringify({ version: 1, goalId, steps: [{ id: "save-local-result", operation: "create", path: "result.txt", text: "42", expectedSha256: createHash("sha256").update("42").digest("hex"), criteria: ["criterion-1"] }] }));
  const service = new CognitiveService(dbPath, { stateRoot, brain: configuredPrimaryBrain(), localWork: { manifestPath, dataRoot } });
  const result = await service.continue(goalId);
  const state = await new CognitiveStateStore(stateRoot, { tenantId: "local", principalId: "owner" }).get(goalId);
  const status = await service.status();
  const outputVerified = await readFile(join(dataRoot, "result.txt"), "utf8") === "42";
  const usedLocalModel = state?.attempts.some(a => a.source === "local-model") === true;
  const passed = result.stopReason === "goal_complete" && result.goalEvaluation?.achieved === true && outputVerified && usedLocalModel && status.metrics.externalAiCallsPerGoal === 0;
  console.log(JSON.stringify({ passed, model: process.env.GAI_LOCAL_MODEL_NAME, elapsedMs: Date.now() - started, usedLocalModel, outputVerified, goalCompleted: result.goalEvaluation?.achieved, externalAiCallsPerGoal: status.metrics.externalAiCallsPerGoal, boundedCatalogOnly: true, generalUnknownTaskClaim: false }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
