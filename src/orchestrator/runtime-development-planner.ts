import type { ActionResult, ContextItem, Goal, InferredIntent, Planner, ProposedAction } from "./goal-loop.ts";
import { goalWorkStateId } from "./work-state-integration.ts";
import { createHash } from "node:crypto";

const DEVELOPMENT_MARKERS = /(code|coding|implement|implementation|fix|repair|refactor|test|build|source|repository|script|patch|develop|development|コード|実装|修正|改修|開発|テスト)/i;
const IMPLEMENTATION_DOD_MARKERS = /(code|implement|implementation|fix|repair|refactor|source|script|patch|develop|development|コード|実装|修正|改修|開発)/i;
const VERIFICATION_DOD_MARKERS = /(^|[^a-z])(test|tests|verify|verification|lint|build|security|review|deploy)([^a-z]|$)|テスト|検証|確認|ビルド|セキュリティ|レビュー|デプロイ/i;
const AUTOMATED_CHECK_DOD_MARKERS = /(^|[^a-z])(test|tests|verify|verification|lint|build|security)([^a-z]|$)|テスト|検証|確認|ビルド|セキュリティ/i;

interface WorkStateSnapshotData {
  status?: unknown;
  blockers?: unknown;
  remainingDefinitionOfDone?: unknown;
}
interface RemainingDefinitionOfDoneItem { id?: unknown; description?: unknown; }
interface RepositoryContextData {
  baseRevision: string;
  contextDigest: string;
  targetFiles: string[];
  localOnly: boolean;
  previousStrategyFingerprints: string[];
}

function repositoryContext(context: ContextItem[]): RepositoryContextData | null {
  const item = context.find((entry) => entry.source === "development.repository_context");
  if (!item?.data || typeof item.data !== "object" || Array.isArray(item.data)) return null;
  const value = item.data as Partial<RepositoryContextData>;
  if (!/^[a-f0-9]{40,64}$/.test(value.baseRevision ?? "") || !/^[a-f0-9]{64}$/.test(value.contextDigest ?? "")) return null;
  if (!Array.isArray(value.targetFiles) || value.targetFiles.some((path) => typeof path !== "string")) return null;
  if (value.localOnly !== undefined && typeof value.localOnly !== "boolean") return null;
  if (value.previousStrategyFingerprints !== undefined && (!Array.isArray(value.previousStrategyFingerprints) || value.previousStrategyFingerprints.some((fingerprint) => !/^[a-f0-9]{64}$/.test(fingerprint)))) return null;
  return {
    baseRevision: value.baseRevision!,
    contextDigest: value.contextDigest!,
    targetFiles: [...new Set(value.targetFiles)],
    localOnly: value.localOnly === true,
    previousStrategyFingerprints: [...new Set(value.previousStrategyFingerprints ?? [])],
  };
}

function workStateSnapshot(context: ContextItem[]): WorkStateSnapshotData | null {
  const item = context.find((entry) => entry.source === "gai-work-state");
  if (!item?.data || typeof item.data !== "object" || Array.isArray(item.data)) return null;
  return item.data as WorkStateSnapshotData;
}
function workStateCompleted(context: ContextItem[]): boolean {
  const snapshot = workStateSnapshot(context);
  if (!snapshot || snapshot.status !== "COMPLETED") return false;
  const blockers = Array.isArray(snapshot.blockers) ? snapshot.blockers : [];
  return blockers.length === 0;
}
function implementationDefinitionOfDoneIds(context: ContextItem[]): string[] {
  const snapshot = workStateSnapshot(context);
  if (!snapshot || !Array.isArray(snapshot.remainingDefinitionOfDone)) return [];
  return snapshot.remainingDefinitionOfDone.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as RemainingDefinitionOfDoneItem;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!id || !description) return [];
    // A file path such as tests/fixtures/result.txt names the implementation
    // target; its directory name is not a repository-wide test requirement.
    const wording = description.replace(/(?:src|tests|scripts|docs)\/[A-Za-z0-9_./-]+/g, " ");
    if (!IMPLEMENTATION_DOD_MARKERS.test(wording) || VERIFICATION_DOD_MARKERS.test(wording)) return [];
    return [id];
  });
}
function automatedCheckDefinitionOfDoneIds(context: ContextItem[]): string[] {
  const snapshot = workStateSnapshot(context);
  if (!snapshot || !Array.isArray(snapshot.remainingDefinitionOfDone)) return [];
  return snapshot.remainingDefinitionOfDone.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as RemainingDefinitionOfDoneItem;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    return id && description && AUTOMATED_CHECK_DOD_MARKERS.test(description) ? [id] : [];
  });
}
function nextAction(context: ContextItem[]): string | null {
  const direct = context.find((item) => item.source === "state.next_action")?.summary?.trim();
  if (direct && !["none","null","undefined"].includes(direct.toLowerCase())) return direct;
  for (const item of context) {
    if (!item.data || typeof item.data !== "object" || Array.isArray(item.data)) continue;
    const value = (item.data as { nextAction?: unknown }).nextAction;
    if (typeof value === "string" && value.trim() && !["none","null","undefined"].includes(value.trim().toLowerCase())) return value.trim();
  }
  return null;
}
function extractFiles(value: string): string[] {
  const matches = value.match(/(?:src|tests|scripts|docs)\/[A-Za-z0-9_./-]+/g) ?? [];
  return [...new Set(matches.map((item) => item.replace(/[),.;:]+$/, "")))].slice(0, 20);
}
function trustedVerificationContract(context: ContextItem[], files: string[]) {
  for (const item of context) {
    let raw: unknown = null;
    if (item.source === "development.verification_contract") raw = item.data;
    else if (item.data && typeof item.data === "object" && !Array.isArray(item.data)) {
      const wrapper = item.data as { source?: unknown; data?: unknown };
      if (wrapper.source === "development.verification_contract") raw = wrapper.data;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const contract = raw as { kind?: unknown; path?: unknown; expected?: unknown };
    if (contract.kind !== "file_exact" || typeof contract.path !== "string" || typeof contract.expected !== "string") continue;
    if (!files.includes(contract.path) || !contract.expected || contract.expected.length > 10_000) continue;
    return { kind: "file_exact" as const, path: contract.path, expected: contract.expected };
  }
  return null;
}

function exactFileVerification(value: string, files: string[]) {
  if (files.length !== 1) return null;
  const marker = "complete content exactly";
  const lower = value.toLowerCase();
  const idx = lower.indexOf(marker);
  if (idx < 0) return null;
  const tail = value.slice(idx + marker.length).trim().replace(/^[:=]\s*/, "");
  const expected = tail.split(/[.\n]/)[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
  if (!expected || expected.length > 10000) return null;
  return { kind: "file_exact" as const, path: files[0], expected };
}
function failureSignature(result?: ActionResult | null): string[] {
  if (!result || result.ok) return [];
  const detail = (result.blocker || result.summary || "unknown-failure").trim().toLowerCase().replace(/\s+/g, " ");
  return [`${result.actionId}:${detail}`];
}

export class RuntimeDevelopmentPlanner implements Planner {
  readonly supersedesPriorExecutionState?: boolean;
  private readonly delegate: Planner;
  constructor(delegate: Planner) {
    this.delegate = delegate;
    this.supersedesPriorExecutionState = delegate.supersedesPriorExecutionState;
  }
  inferIntent(input: { goal: Goal; context: ContextItem[]; preferences?: string[]; recentDecisions?: string[]; }): Promise<InferredIntent> {
    return this.delegate.inferIntent(input);
  }
  async proposeNextAction(input: { goal: Goal; context: ContextItem[]; intent: InferredIntent; previousResult?: ActionResult | null; }): Promise<ProposedAction | null> {
    if (input.context.some((item) => item.source === "goal.complete" && item.summary === "true")) return null;
    if (workStateCompleted(input.context)) return null;
    const next = nextAction(input.context);
    const scope = [input.goal.title, input.goal.description ?? "", next ?? "", input.intent.summary].join("\n");
    if (!DEVELOPMENT_MARKERS.test(scope)) return this.delegate.proposeNextAction(input);

    const recovery = input.previousResult && !input.previousResult.ok;
    const now = Date.now();
    const objective = next || input.goal.description?.trim() || input.goal.title;
    const repository = repositoryContext(input.context);
    const files = repository?.targetFiles.length ? repository.targetFiles : extractFiles(scope);
    const verificationContract = trustedVerificationContract(input.context, files)
      ?? exactFileVerification(scope, files)
      ?? { kind: "repository_checks" as const, profile: "standard" as const };
    const satisfiesDefinitionOfDone = [
      ...implementationDefinitionOfDoneIds(input.context),
      ...(verificationContract.kind === "repository_checks" ? automatedCheckDefinitionOfDoneIds(input.context) : []),
    ];
    const hypothesis = recovery
      ? `Use verifier evidence and a materially different implementation for ${input.previousResult?.actionId ?? "the failed attempt"}`
      : "Use a focused failing test followed by the smallest implementation";
    const strategyDigest = createHash("sha256").update(JSON.stringify({ objective, files, hypothesis, contextDigest: repository?.contextDigest ?? null })).digest("hex").slice(0, 24);
    return {
      id: `runtime-builder:${goalWorkStateId(input.goal)}`,
      description: objective,
      capability: "code.builder",
      risk: "low",
      irreversible: false,
      externalSideEffect: false,
      ...(satisfiesDefinitionOfDone.length > 0 ? { satisfiesDefinitionOfDone } : {}),
      input: {
        goalId: goalWorkStateId(input.goal),
        attemptId: `attempt-${now}`,
        strategyId: recovery ? `recovery-${strategyDigest}` : `initial-${strategyDigest}`,
        hypothesis,
        ...(repository ? {
          baseRevision: repository.baseRevision,
          localOnly: repository.localOnly,
          previousStrategyFingerprints: repository.previousStrategyFingerprints,
        } : {}),
        objective: recovery
          ? (() => {
              const evidence = input.previousResult?.evidence;
              if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
                const exact = evidence as { kind?: unknown; path?: unknown; expected?: unknown; actual?: unknown };
                if (exact.kind === "file_exact" && typeof exact.path === "string" && typeof exact.expected === "string") {
                  return `Repair ${exact.path} so its complete content exactly matches verifier expected value ${JSON.stringify(exact.expected)}. The prior result was ${JSON.stringify(exact.actual ?? null)}. This verifier evidence is available only after failure; use it to correct the implementation.`;
                }
              }
              return `${objective}. Previous attempt failed: ${input.previousResult?.summary ?? "unknown failure"}. Use a materially different implementation strategy.`;
            })()
          : objective,
        ...(files.length > 0 ? { files } : {}),
        ...(verificationContract ? { verificationContract } : {}),
        previousFailureSignatures: failureSignature(input.previousResult),
      },
    };
  }
}
