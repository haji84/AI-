import type { ActionResult } from "./goal-loop.ts";
import type { BuilderCapability, BuilderRequest } from "./builder-router.ts";
import {
  normalizeDevelopmentBuilderResult,
  type RawDevelopmentBuilderResult,
} from "./development-builder.ts";

export interface LocalDevelopmentBuilderInput extends BuilderRequest {
  workspaceRoot: string;
}
export interface LocalDevelopmentBuilderOptions {
  id: string;
  workspaceRoot: string;
  available?: () => boolean | Promise<boolean>;
  run(input: LocalDevelopmentBuilderInput): Promise<RawDevelopmentBuilderResult>;
}

export class LocalDevelopmentBuilder implements BuilderCapability {
  readonly kind = "local" as const;
  readonly id: string;
  private readonly workspaceRoot: string;
  private readonly checkAvailable?: () => boolean | Promise<boolean>;
  private readonly run: LocalDevelopmentBuilderOptions["run"];

  constructor(options: LocalDevelopmentBuilderOptions) {
    if (!options.id.trim() || !options.workspaceRoot.trim()) throw new Error("local Builder identity and workspace are required");
    this.id = options.id;
    this.workspaceRoot = options.workspaceRoot;
    this.checkAvailable = options.available;
    this.run = options.run;
  }

  async available(): Promise<boolean> {
    return this.checkAvailable ? Boolean(await this.checkAvailable()) : true;
  }

  async build(request: BuilderRequest): Promise<ActionResult> {
    if (!(await this.available())) {
      return {
        actionId: request.attemptId,
        ok: false,
        summary: `Local Builder ${this.id} is unavailable`,
        blocker: "local_builder_unavailable",
        evidence: { builderId: this.id, builderKind: this.kind },
      };
    }
    try {
      const normalized = normalizeDevelopmentBuilderResult(
        request,
        await this.run({ ...request, workspaceRoot: this.workspaceRoot }),
        { builderId: this.id, kind: this.kind },
      );
      return {
        actionId: request.attemptId,
        ok: normalized.ok,
        summary: normalized.summary,
        blocker: normalized.blocker,
        evidence: {
          builderId: this.id,
          builderKind: this.kind,
          changeSet: normalized.changeSet ?? null,
          builderEvidence: normalized.evidence ?? null,
        },
      };
    } catch (error) {
      return {
        actionId: request.attemptId,
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        blocker: "local_builder_contract_rejected",
        evidence: { builderId: this.id, builderKind: this.kind },
      };
    }
  }
}
