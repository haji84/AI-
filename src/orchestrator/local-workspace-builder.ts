import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ActionResult } from "./goal-loop.ts";
import type { BuilderCapability, BuilderRequest } from "./builder-router.ts";

export interface FilePatch {
  path: string;
  expected?: string;
  replacement: string;
}

export class LocalWorkspaceBuilder implements BuilderCapability {
  readonly id = "local-workspace-builder";
  private readonly root: string;

  constructor(root = process.cwd()) { this.root = resolve(root); }

  async available(): Promise<boolean> { return true; }

  async build(request: BuilderRequest): Promise<ActionResult> {
    const patches = (request.context
      .map((item) => item.data)
      .filter((data): data is { strategyId?: string; patches?: FilePatch[] } => !!data && typeof data === "object")
      .find((data) => data.strategyId === request.strategyId)?.patches) ?? [];

    if (patches.length === 0) {
      return { actionId: request.attemptId, ok: false, summary: "No bounded file patch supplied", blocker: "builder_patch_missing" };
    }

    const changed: string[] = [];
    for (const patch of patches) {
      const absolute = resolve(this.root, patch.path);
      if (!absolute.startsWith(this.root)) {
        return { actionId: request.attemptId, ok: false, summary: "Patch escaped workspace", blocker: "builder_scope_violation" };
      }
      await mkdir(dirname(absolute), { recursive: true });
      let before = "";
      try { before = await readFile(absolute, "utf8"); } catch { /* new file */ }
      if (patch.expected !== undefined && !before.includes(patch.expected)) {
        return { actionId: request.attemptId, ok: false, summary: `Expected source not found in ${patch.path}`, blocker: "builder_expected_source_missing" };
      }
      const after = patch.expected === undefined ? patch.replacement : before.replace(patch.expected, patch.replacement);
      await writeFile(absolute, after, "utf8");
      changed.push(patch.path);
    }
    return {
      actionId: request.attemptId,
      ok: true,
      summary: `Applied strategy ${request.strategyId} to ${changed.length} file(s)`,
      evidence: { builder: this.id, strategyId: request.strategyId, changed },
    };
  }
}
