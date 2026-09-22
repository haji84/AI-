import type { CapabilityHandler } from "./common-worker-runtime.ts";
import type { WorkerCapability } from "./worker-runtime.ts";

export const developmentToolingOperations = ["lint", "test", "typecheck", "build"] as const;
export type DevelopmentToolingOperation = (typeof developmentToolingOperations)[number];
export type DevelopmentToolingPlatform = "windows" | "macos";

export interface DevelopmentToolingRequest {
  operation: DevelopmentToolingOperation;
  workspace: string;
  target?: string;
}

export interface DevelopmentToolingBridgeResult {
  ok: boolean;
  status: string;
  exitCode?: number;
  checkIds?: string[];
  artifactRefs?: string[];
}

export interface DevelopmentToolingBridge {
  platform: DevelopmentToolingPlatform;
  execute(request: DevelopmentToolingRequest & { taskId: string }): Promise<DevelopmentToolingBridgeResult>;
}

export interface DevelopmentToolingHandlerOptions {
  bridge: DevelopmentToolingBridge;
  allowedOperations: readonly DevelopmentToolingOperation[];
  allowedWorkspaces: readonly string[];
  allowedTargets?: readonly string[];
}

const capabilityByPlatform: Record<DevelopmentToolingPlatform, WorkerCapability> = {
  windows: "windows-tooling",
  macos: "macos-tooling",
};
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const requestKeys = new Set(["operation", "workspace", "target"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSafeIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw new Error(`development_tooling_invalid_${field}`);
  }
  return value;
}

function requireConfiguredIdentifiers(values: readonly string[], field: string): Set<string> {
  if (values.length === 0) throw new Error(`development_tooling_empty_${field}_allowlist`);
  const checked = values.map((value) => requireSafeIdentifier(value, field));
  return new Set(checked);
}

function parseRequest(input: string, options: DevelopmentToolingHandlerOptions): DevelopmentToolingRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    throw new Error("development_tooling_invalid_json");
  }
  if (!isRecord(raw)) throw new Error("development_tooling_invalid_request");
  const unexpected = Object.keys(raw).filter((key) => !requestKeys.has(key));
  if (unexpected.length > 0) throw new Error("development_tooling_unexpected_field");

  const operation = raw.operation;
  if (typeof operation !== "string" || !developmentToolingOperations.includes(operation as DevelopmentToolingOperation)) {
    throw new Error("development_tooling_invalid_operation");
  }
  if (!options.allowedOperations.includes(operation as DevelopmentToolingOperation)) {
    throw new Error("development_tooling_operation_not_allowed");
  }

  const workspace = requireSafeIdentifier(raw.workspace, "workspace");
  const workspaces = requireConfiguredIdentifiers(options.allowedWorkspaces, "workspace");
  if (!workspaces.has(workspace)) throw new Error("development_tooling_workspace_not_allowed");

  let target: string | undefined;
  if (raw.target !== undefined) {
    target = requireSafeIdentifier(raw.target, "target");
    const targets = requireConfiguredIdentifiers(options.allowedTargets ?? [], "target");
    if (!targets.has(target)) throw new Error("development_tooling_target_not_allowed");
  }

  return { operation: operation as DevelopmentToolingOperation, workspace, ...(target ? { target } : {}) };
}

function normalizeEvidenceList(value: string[] | undefined, field: string): string[] {
  if (!value) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error(`development_tooling_invalid_${field}`);
  return value.map((item) => requireSafeIdentifier(item, field));
}

function validateBridgeResult(result: DevelopmentToolingBridgeResult): DevelopmentToolingBridgeResult {
  const status = requireSafeIdentifier(result.status, "bridge_status");
  if (result.exitCode !== undefined && (!Number.isSafeInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255)) {
    throw new Error("development_tooling_invalid_exit_code");
  }
  return {
    ok: result.ok === true,
    status,
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    checkIds: normalizeEvidenceList(result.checkIds, "check_id"),
    artifactRefs: normalizeEvidenceList(result.artifactRefs, "artifact_ref"),
  };
}

export function createDevelopmentToolingCapabilityHandler(options: DevelopmentToolingHandlerOptions): CapabilityHandler {
  if (options.allowedOperations.length === 0) throw new Error("development_tooling_empty_operation_allowlist");
  for (const operation of options.allowedOperations) {
    if (!developmentToolingOperations.includes(operation)) throw new Error("development_tooling_invalid_operation_allowlist");
  }
  requireConfiguredIdentifiers(options.allowedWorkspaces, "workspace");
  if (options.allowedTargets) requireConfiguredIdentifiers(options.allowedTargets, "target");

  return async (request, context) => {
    const expectedCapability = capabilityByPlatform[options.bridge.platform];
    if (context.worker.platform !== options.bridge.platform || context.capability !== expectedCapability) {
      throw new Error("development_tooling_platform_capability_mismatch");
    }

    const parsed = parseRequest(request.input, options);
    const result = validateBridgeResult(await options.bridge.execute({ taskId: request.task.id, ...parsed }));
    if (!result.ok) throw new Error(`development_tooling_failed:${result.status}`);

    return {
      output: `development_tooling:${parsed.operation}:${result.status}`,
      evidence: {
        developmentTooling: {
          platform: options.bridge.platform,
          operation: parsed.operation,
          workspace: parsed.workspace,
          target: parsed.target ?? null,
          status: result.status,
          exitCode: result.exitCode ?? null,
          checkIds: result.checkIds ?? [],
          artifactRefs: result.artifactRefs ?? [],
        },
      },
    };
  };
}
