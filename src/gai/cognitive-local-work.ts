import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { LocalFileCapability } from "../orchestrator/local-file-capability.ts";
import { LocalArtifactVerifier } from "../orchestrator/local-artifact-verifier.ts";
import type { CapabilityRegistry } from "../orchestrator/capabilities.ts";
import type { Goal, ProposedAction, Verifier } from "../orchestrator/goal-loop.ts";
import type { WorkStateAction } from "../orchestrator/work-state-integration.ts";
import { assertCognitiveSafe, cognitiveDigest } from "./cognitive-state.ts";
import type { CognitiveCandidate } from "./cognitive-core.ts";

/** Host-authored bounded manifest, never a model-supplied permission or verifier. */
export interface CognitiveLocalWorkManifest {
  version: 1;
  goalId: string;
  steps: Array<{ id: string; operation: "read" | "create"; path: string; text?: string; expectedSha256: string; criteria: string[]; dependsOn?: string[] }>;
}
const MAX_FILE_BYTES = 64_000;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export class CognitiveLocalWorkCatalog {
  readonly contractDigest: string;
  private readonly manifest: CognitiveLocalWorkManifest;
  private readonly root: string;
  private readonly files: LocalFileCapability;
  constructor(root: string, manifest: CognitiveLocalWorkManifest, goalId: string, goal: Goal) {
    assertCognitiveSafe(manifest);
    if (!manifest || manifest.version !== 1 || manifest.goalId !== goalId || Object.keys(manifest).some(k => !["version", "goalId", "steps"].includes(k)) ||
        !Array.isArray(manifest.steps) || !manifest.steps.length || manifest.steps.length > 24) throw Error("Invalid local work manifest");
    const ids = new Set<string>();
    for (const step of manifest.steps) {
      if (!step || Object.keys(step).some(k => !["id", "operation", "path", "text", "expectedSha256", "criteria", "dependsOn"].includes(k)) ||
          typeof step.id !== "string" || !/^[a-zA-Z0-9:_-]{1,80}$/.test(step.id) || ids.has(step.id) ||
          !["read", "create"].includes(step.operation) || typeof step.path !== "string" || !step.path.trim() ||
          !/^[a-f0-9]{64}$/.test(step.expectedSha256)) throw Error("Invalid local step");
      const rel = relative(resolve(root), resolve(root, step.path));
      if (isAbsolute(step.path) || isAbsolute(rel) || !rel || rel === ".." || rel.startsWith(".." + sep) || /(^|[\\/])(?:\.git|\.env[^\\/]*|credentials?)([\\/]|$)/i.test(rel)) throw Error("Local work path outside data scope");
      if (!Array.isArray(step.criteria) || step.criteria.some(c => !goal.successCriteria.some((_, index) => c === "criterion-" + (index + 1)))) throw Error("Unknown Goal criterion");
      if (step.dependsOn !== undefined && (!Array.isArray(step.dependsOn) || step.dependsOn.some(id => !ids.has(id)))) throw Error("Local dependencies must reference earlier steps");
      if (step.operation === "create" && (typeof step.text !== "string" || Buffer.byteLength(step.text) > MAX_FILE_BYTES || sha(step.text) !== step.expectedSha256)) throw Error("Create content must match independent host contract");
      if (step.operation === "read" && step.text !== undefined) throw Error("Read cannot carry content");
      ids.add(step.id);
    }
    this.manifest = structuredClone(manifest); this.root = resolve(root); this.contractDigest = cognitiveDigest({ kind: "steps", root: this.root, manifest: this.manifest }); this.files = new LocalFileCapability(this.root);
  }
  private candidateId(step: CognitiveLocalWorkManifest["steps"][number]) { return "local-file:" + cognitiveDigest(step).slice(0, 32); }
  async candidates(completedIds: string[] = []): Promise<CognitiveCandidate[]> {
    return this.manifest.steps.filter(step => (step.dependsOn ?? []).every(id => {
      const dependency = this.manifest.steps.find(s => s.id === id)!;
      return completedIds.includes(this.candidateId(dependency));
    })).map(step => {
      const id = this.candidateId(step);
      const action: WorkStateAction = { id, capability: "cognitive.file." + step.operation,
        description: (step.operation === "read" ? "Inspect " : "Create ") + step.path, risk: "low",
        irreversible: false, externalSideEffect: false, materialMutation: step.operation === "create",
        satisfiesDefinitionOfDone: step.criteria, input: { stepId: step.id } };
      return { id, kind: "experiment", action, expectedOutcome: "Artifact matches host SHA-256 and Goal criterion", evidenceRequired: ["independent-local-artifact-verifier"] };
    });
  }
  completionSatisfied(completedIds: string[]): boolean {
    return this.manifest.steps.every(step => completedIds.includes(this.candidateId(step)));
  }
  private step(action: ProposedAction) {
    const step = this.manifest.steps.find(s => this.candidateId(s) === action.id);
    if (!step || action.capability !== "cognitive.file." + step.operation) throw Error("Unknown authorized local action");
    return step;
  }
  register(registry: CapabilityRegistry): void {
    for (const operation of ["read", "create"]) registry.register({
      name: "cognitive.file." + operation,
      execute: async action => {
        const step = this.step(action);
        try {
          if (step.operation === "create") {
            const result = await this.files.createBytes(step.path, Buffer.from(step.text!, "utf8"));
            if (result.status === "blocked") return { actionId: action.id, ok: false, summary: "Existing file differs; overwrite is not authorized", blocker: "local_artifact_conflict" };
          }
          const actualRoot = await realpath(this.root);
          const target = await realpath(resolve(this.root, step.path));
          const rel = relative(actualRoot, target);
          if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep) || (await lstat(target)).size > MAX_FILE_BYTES) throw Error("Read outside bounded data scope");
          const data = await this.files.readBytes(step.path);
          assertCognitiveSafe(data.bytes.toString("utf8"));
          return { actionId: action.id, ok: true, summary: "Local artifact observed: " + step.path,
            evidence: { refs: ["local-observation:" + sha(this.manifest.goalId + ":" + data.sha256)], sha256: data.sha256 } };
        } catch { return { actionId: action.id, ok: false, summary: "Local artifact unavailable or outside data policy", blocker: "local_artifact_unavailable" }; }
      },
    });
  }
  verifier(fallback: Verifier): Verifier {
    return { verify: async input => {
      if (!input.action.capability.startsWith("cognitive.file.")) return fallback.verify(input);
      const step = this.step(input.action);
      const result = await new LocalArtifactVerifier(this.root).verify({ domain: "file", path: step.path, expectedSha256: step.expectedSha256, ...(step.operation === "create" ? { expectedText: step.text } : {}) });
      return { ok: input.result.ok && result.ok, summary: result.ok ? "Persisted local artifact independently verified" : "Local artifact failed independent verification",
        evidence: { refs: ["local-verification:" + sha(this.manifest.goalId + ":" + cognitiveDigest(result.evidence))] } };
    } };
  }
}

/** Only the configured host file is loaded; HTTP callers cannot choose a path/root. */
export async function loadCognitiveLocalWork(path: string, root: string, goalId: string, goal: Goal) {
  if ((await lstat(path)).size > MAX_FILE_BYTES) throw Error("Local manifest exceeds bound");
  return new CognitiveLocalWorkCatalog(await realpath(root), JSON.parse(await readFile(path, "utf8")), goalId, goal);
}
