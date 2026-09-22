import type { WorkAction, WorkCapability, WorkResult } from "./work-capability.ts";
import { ArtifactConflictError, ScopedArtifactStore } from "./scoped-artifact-store.ts";

export class LocalFileCapability implements WorkCapability {
  readonly name = "file.local";
  readonly domain = "file" as const;
  readonly operations = ["read", "write"];
  readonly access = "write" as const;
  readonly externalSideEffect = false;
  readonly maxRisk = "low" as const;
  readonly requiresHumanApproval = false;

  private readonly store: ScopedArtifactStore;

  constructor(root: string) {
    this.store = new ScopedArtifactStore(root);
  }

  available(): Promise<boolean> {
    return this.store.available();
  }

  async execute(action: WorkAction): Promise<WorkResult> {
    try {
      if (action.operation === "read") {
        const artifact = await this.store.read(action.input.path);
        return this.ok(
          action,
          { text: artifact.bytes.toString("utf8"), sha256: artifact.sha256 },
          [],
          artifact.path,
          artifact.sha256,
        );
      }

      if (action.operation === "write") {
        const artifact = await this.store.create(action.input.path, Buffer.from(String(action.input.text ?? ""), "utf8"));
        return this.ok(
          action,
          { path: artifact.path, sha256: artifact.sha256, ...(artifact.idempotent ? { idempotent: true } : {}) },
          artifact.created ? [{ resource: artifact.path, operation: "create", reversible: true }] : [],
          artifact.path,
          artifact.sha256,
        );
      }

      throw new Error("unsupported file operation");
    } catch (error) {
      if (error instanceof ArtifactConflictError) {
        return {
          ok: false,
          status: "blocked",
          outputs: {
            path: error.path,
            currentSha256: error.currentSha256,
            requestedSha256: error.requestedSha256,
          },
          changes: [],
          evidence: [
            {
              kind: "file.overwrite_blocked",
              ref: `file:${error.path}`,
              data: {
                path: error.path,
                currentSha256: error.currentSha256,
                requestedSha256: error.requestedSha256,
              },
            },
          ],
          failureClass: "policy",
          error: error.message,
          provenance: {
            capability: this.name,
            attemptId: action.attemptId,
            strategyId: action.strategyId,
          },
        };
      }

      return {
        ok: false,
        status: "failed",
        outputs: {},
        changes: [],
        evidence: [],
        failureClass: "implementation",
        error: error instanceof Error ? error.message : "file operation failed",
        provenance: {
          capability: this.name,
          attemptId: action.attemptId,
          strategyId: action.strategyId,
        },
      };
    }
  }

  private ok(
    action: WorkAction,
    outputs: Record<string, unknown>,
    changes: WorkResult["changes"],
    target: string,
    sha256: string,
  ): WorkResult {
    return {
      ok: true,
      status: "completed",
      outputs,
      changes,
      evidence: [{ kind: "file.artifact", ref: `file:${target}`, data: { path: target, sha256 } }],
      provenance: {
        capability: this.name,
        attemptId: action.attemptId,
        strategyId: action.strategyId,
      },
    };
  }
}
