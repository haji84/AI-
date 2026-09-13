import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultApprovalPolicy,
  GoalDrivenLoop,
  type ActionResult,
  type CapabilityExecutor,
  type Goal,
  type InferredIntent,
  type LoopState,
  type Planner,
  type ProposedAction,
  type StateStore,
  type VerificationResult,
  type Verifier,
  type WriteBackRecord,
} from "../src/orchestrator/goal-loop.ts";
import { runAdaptiveTeamGoal } from "../src/orchestrator/adaptive-team-runner.ts";
import { TeamMemory } from "../src/orchestrator/team-organizational-memory.ts";

type Scenario = {
  name: string;
  goal: Goal;
  initialCapability: string;
  requestedCapability: string;
  catalog: Array<{ name: string; roles: string[]; matchTerms?: string[] }>;
  expected: "complete" | "blocked" | "approval";
  necessary?: boolean;
  highRisk?: boolean;
  maxCapabilityExpansions?: number;
};

class EmptyStateStore implements StateStore {
  readonly records: WriteBackRecord[] = [];
  async getState(): Promise<LoopState> { return { completed: [], blockers: [] }; }
  async writeBack(record: WriteBackRecord): Promise<void> { this.records.push(structuredClone(record)); }
}

class OneShotPlanner implements Planner {
  private readonly action: ProposedAction;
  constructor(action: ProposedAction) { this.action = action; }
  async inferIntent(): Promise<InferredIntent> {
    return { summary: "complete the unseen task", confidence: 1, evidence: [] };
  }
  async proposeNextAction(): Promise<ProposedAction> { return { ...this.action }; }
}

class PassVerifier implements Verifier {
  async verify(): Promise<VerificationResult> { return { ok: true, summary: "verified" }; }
}

function executor(): CapabilityExecutor {
  return {
    async execute(action: ProposedAction): Promise<ActionResult> {
      return { actionId: action.id, ok: true, summary: `executed:${action.capability}` };
    },
  };
}

function loopFor(action: ProposedAction) {
  return (scoped: CapabilityExecutor) => new GoalDrivenLoop(
    new OneShotPlanner(action), [], scoped, new PassVerifier(), new EmptyStateStore(), new DefaultApprovalPolicy(),
  );
}

const scenarios: Scenario[] = [
  { name: "設備点検CSVから異常だけ抽出して要約", goal: { title: "設備点検CSVの異常抽出", successCriteria: ["異常項目を要約する"], constraints: [] }, initialCapability: "csv.read", requestedCapability: "data.analyze", catalog: [{ name: "csv.read", roles: ["読込"], matchTerms: ["csv"] }, { name: "data.analyze", roles: ["分析"] }], expected: "complete" },
  { name: "画像一覧から撮影日時を抽出して台帳化", goal: { title: "画像撮影日時の台帳化", successCriteria: ["画像の撮影日時を台帳にする"], constraints: [] }, initialCapability: "image.inspect", requestedCapability: "table.write", catalog: [{ name: "image.inspect", roles: ["画像解析"], matchTerms: ["画像"] }, { name: "table.write", roles: ["台帳作成"] }], expected: "complete" },
  { name: "議事録から決定事項を抽出してMarkdown化", goal: { title: "議事録の決定事項整理", successCriteria: ["決定事項をMarkdownで整理する"], constraints: [] }, initialCapability: "text.extract", requestedCapability: "markdown.write", catalog: [{ name: "text.extract", roles: ["抽出"], matchTerms: ["議事録"] }, { name: "markdown.write", roles: ["文書化"] }], expected: "complete" },
  { name: "複数ログから重複エラーをまとめる", goal: { title: "重複エラー集約", successCriteria: ["重複を除いたエラー一覧を作る"], constraints: [] }, initialCapability: "log.read", requestedCapability: "deduplicate", catalog: [{ name: "log.read", roles: ["ログ読込"], matchTerms: ["ログ"] }, { name: "deduplicate", roles: ["重複排除"] }], expected: "complete" },
  { name: "未知形式の結果をJSONへ正規化", goal: { title: "結果データJSON正規化", successCriteria: ["結果をJSONとして正規化する"], constraints: [] }, initialCapability: "data.read", requestedCapability: "json.normalize", catalog: [{ name: "data.read", roles: ["読込"], matchTerms: ["データ"] }, { name: "json.normalize", roles: ["正規化"] }], expected: "complete" },
  { name: "不要なシェル能力を途中要求", goal: { title: "文章の要点抽出", successCriteria: ["文章の要点だけ返す"], constraints: ["外部変更をしない"] }, initialCapability: "text.summarize", requestedCapability: "shell.execute", catalog: [{ name: "text.summarize", roles: ["要約"], matchTerms: ["要点"] }, { name: "shell.execute", roles: ["シェル"] }], expected: "blocked", necessary: false },
  { name: "登録されていない能力を途中要求", goal: { title: "音声メモを整理", successCriteria: ["文字起こし後に分類する"], constraints: [] }, initialCapability: "audio.transcribe", requestedCapability: "taxonomy.classify", catalog: [{ name: "audio.transcribe", roles: ["文字起こし"], matchTerms: ["音声"] }], expected: "blocked" },
  { name: "能力増員予算ゼロ", goal: { title: "表からPDF報告書作成", successCriteria: ["PDF報告書を生成する"], constraints: [] }, initialCapability: "table.read", requestedCapability: "pdf.render", catalog: [{ name: "table.read", roles: ["表読込"], matchTerms: ["表"] }, { name: "pdf.render", roles: ["PDF"] }], expected: "blocked", maxCapabilityExpansions: 0 },
  { name: "本番デプロイ要求はHuman Gate", goal: { title: "アプリを本番公開", successCriteria: ["本番環境へ公開する"], constraints: [] }, initialCapability: "build.app", requestedCapability: "deploy.production", catalog: [{ name: "build.app", roles: ["ビルド"], matchTerms: ["アプリ"] }, { name: "deploy.production", roles: ["本番デプロイ"] }], expected: "approval", highRisk: true },
  { name: "権限変更要求はHuman Gate", goal: { title: "共有設定を変更", successCriteria: ["指定ユーザーへ編集権限を与える"], constraints: [] }, initialCapability: "resource.inspect", requestedCapability: "permission.change", catalog: [{ name: "resource.inspect", roles: ["確認"], matchTerms: ["共有"] }, { name: "permission.change", roles: ["権限変更"] }], expected: "approval", highRisk: true },
];

for (const scenario of scenarios) {
  test(`unknown-task: ${scenario.name}`, async () => {
    const memory = new TeamMemory();
    const action: ProposedAction = { id: `action:${scenario.requestedCapability}`, description: scenario.name, capability: scenario.requestedCapability, risk: scenario.highRisk ? "high" : "low", requiresHumanApproval: scenario.highRisk || undefined, completesBoundedCommand: true };
    const report = await runAdaptiveTeamGoal({
      goal: scenario.goal,
      availableCapabilities: scenario.catalog,
      requirements: [{ role: "initial", capability: scenario.initialCapability, reason: "initial task capability" }],
      memory,
      executor: executor(),
      createLoop: loopFor(action),
      maxCapabilityExpansions: scenario.maxCapabilityExpansions,
      evaluateExpansionNecessity: scenario.necessary === false ? async () => ({ necessary: false, reason: "not required by Goal/DoD" }) : async () => ({ necessary: true, reason: "required to satisfy Goal/DoD" }),
      createBlueprintId: () => `bp:${scenario.name}`,
    });
    if (scenario.expected === "complete") {
      assert.equal(report.run?.stopReason, "goal_complete");
      assert.equal(report.teamOutcome?.verified, true);
      assert.equal(report.expansions.filter((item) => item.accepted).length, 1);
      assert.ok(report.teamPlan.assignments.some((item) => item.capability === scenario.requestedCapability));
      assert.ok(report.blueprintId);
    } else if (scenario.expected === "approval") {
      assert.equal(report.run?.stopReason, "approval_required");
      assert.equal(report.expansions.length, 0);
      assert.equal(report.teamOutcome, null);
    } else {
      assert.equal(report.run, null);
      assert.match(report.blockedReason ?? "", /capability_/);
      assert.equal(report.teamOutcome, null);
    }
  });
}

test("unknown-task transfer: learned expanded team is recalled on a second equivalent goal", async () => {
  const memory = new TeamMemory();
  const goal: Goal = { title: "CSV異常抽出レポート", successCriteria: ["異常を分析して要約する"], constraints: [] };
  const catalog = [{ name: "csv.read", roles: ["読込"], matchTerms: ["csv"] }, { name: "data.analyze", roles: ["分析"] }];
  const action: ProposedAction = { id: "analyze", description: "異常分析", capability: "data.analyze", risk: "low", completesBoundedCommand: true };
  const first = await runAdaptiveTeamGoal({ goal, availableCapabilities: catalog, requirements: [{ role: "読込", capability: "csv.read", reason: "CSV読込" }], memory, executor: executor(), createLoop: loopFor(action), evaluateExpansionNecessity: async () => ({ necessary: true, reason: "analysis required" }), createBlueprintId: () => "bp:expanded-csv" });
  assert.equal(first.teamSource, "assembled");
  assert.equal(first.run?.stopReason, "goal_complete");
  assert.equal(first.expansions.filter((item) => item.accepted).length, 1);
  const second = await runAdaptiveTeamGoal({ goal, availableCapabilities: catalog, requirements: [{ role: "読込", capability: "csv.read", reason: "CSV読込" }], memory, executor: executor(), createLoop: loopFor(action) });
  assert.equal(second.teamSource, "recalled");
  assert.equal(second.run?.stopReason, "goal_complete");
  assert.equal(second.expansions.length, 0);
});
