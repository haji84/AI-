import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createDashboardBoundedPlan,
  dashboardCommandNeedsReasoning,
  dashboardCommandStartsFreshTask,
} from "../../../orchestrator/dashboard-command-routing.ts";
import { createTaskCompletionAuthorization } from "../../../orchestrator/task-authorization.ts";
import { readDashboardState } from "../../dashboard-state.ts";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../owner-auth.ts";

const MAX_COMMAND_LENGTH = 500;

async function ownerContext() {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  const githubToken = process.env.AI_COMPANY_GITHUB_TOKEN?.trim() || "";
  const repository = process.env.AI_COMPANY_GITHUB_REPOSITORY?.trim() || "haji84/AI-";
  if (!ownerSecret || !githubToken) return { error: NextResponse.json({ message: "操作機能の設定が不足しています" }, { status: 503 }) };

  const cookieStore = await cookies();
  if (!verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value)) {
    return { error: NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 }) };
  }

  return { ownerSecret, githubToken, repository };
}

function githubHeaders(githubToken: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function freshTaskTitle(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  return `task: ${compact}`.slice(0, 120);
}

async function createFreshTaskIssue(repository: string, githubToken: string, command: string): Promise<number> {
  const response = await fetch(`https://api.github.com/repos/${repository}/issues`, {
    method: "POST",
    headers: githubHeaders(githubToken),
    body: JSON.stringify({
      title: freshTaskTitle(command),
      body: [
        "## Owner command",
        command,
        "",
        "## Execution contract",
        "- source: AI会社コントロールセンター / Chat",
        "- fresh owner command: this Issue is the task scope",
        "- LOW/MEDIUMのみ自律実行",
        "- Work/Codexは明示承認まで使用しない",
        "- HIGH/CRITICALは既存Human Gateで停止",
        "- verification / write-backを必須とする",
      ].join("\n"),
    }),
  });
  const payload = await response.json().catch(() => null) as { number?: unknown; message?: unknown } | null;
  const issueNumber = typeof payload?.number === "number" ? payload.number : 0;
  if (!response.ok || !Number.isInteger(issueNumber) || issueNumber < 1) {
    const detail = typeof payload?.message === "string" ? `: ${payload.message}` : "";
    throw new Error(`GitHub task issue creation failed (${response.status})${detail}`);
  }
  return issueNumber;
}

export async function GET() {
  const context = await ownerContext();
  if ("error" in context) return context.error;

  const state = await readDashboardState();
  const humanGateRequired = state.decisions.length > 0;
  const reply = humanGateRequired
    ? `Human Gateで停止しています。${state.nextAction ? ` 次: ${state.nextAction}` : " 内容を確認して承認または却下してください。"}`
    : state.verificationSummary
      ? `最新の検証結果: ${state.verificationSummary}`
      : state.nextAction
        ? `現在は${state.status}です。次: ${state.nextAction}`
        : `現在は${state.status}です。`;

  return NextResponse.json({
    status: state.status,
    generatedAt: state.generatedAt,
    riskLevel: state.riskLevel,
    nextAction: state.nextAction,
    verificationSummary: state.verificationSummary,
    humanGateRequired,
    decisionCount: state.decisions.length,
    reply,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await ownerContext();
  if ("error" in context) return context.error;
  const { githubToken, repository } = context;

  const payload = await request.json().catch(() => null) as { command?: unknown } | null;
  const command = typeof payload?.command === "string" ? payload.command.trim() : "";
  if (!command) return NextResponse.json({ message: "指示を入力してください" }, { status: 400 });
  if (command.length > MAX_COMMAND_LENGTH) return NextResponse.json({ message: `指示は${MAX_COMMAND_LENGTH}文字以内で入力してください` }, { status: 400 });

  const reasoningHandoffRequired = dashboardCommandNeedsReasoning(command);
  const startsFreshTask = dashboardCommandStartsFreshTask(command);
  let taskIssueNumber: number | null = null;

  if (startsFreshTask) {
    try {
      taskIssueNumber = await createFreshTaskIssue(repository, githubToken, command);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      return NextResponse.json({ message: `新しいタスクの作成に失敗しました: ${detail}` }, { status: 502 });
    }
  }

  const taskScopeId = taskIssueNumber ? `issue:${taskIssueNumber}` : undefined;
  const taskAuthorization = createTaskCompletionAuthorization(command, { scopeId: taskScopeId });
  const plan = createDashboardBoundedPlan(command);
  const commandPayload = {
    source: "chat",
    command,
    ...(taskIssueNumber ? { goalId: `issue:${taskIssueNumber}` } : {}),
    ...(taskAuthorization ? { taskAuthorization } : {}),
    ...(plan ? { plan } : {}),
  };

  const response = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: "POST",
    headers: githubHeaders(githubToken),
    body: JSON.stringify({
      event_type: "ai-autonomy-run",
      client_payload: { command_json: JSON.stringify(commandPayload) },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({
      message: taskIssueNumber
        ? `Issue #${taskIssueNumber} は作成しましたが、GitHubへの実行指示送信に失敗しました (${response.status})`
        : `GitHubへの指示送信に失敗しました (${response.status})`,
      ...(taskIssueNumber ? { taskIssueNumber } : {}),
    }, { status: 502 });
  }

  const message = reasoningHandoffRequired
    ? taskAuthorization
      ? `${taskIssueNumber ? `Issue #${taskIssueNumber} を新規タスクとして作成しました。` : ""}指示を受け付けました。Chat reasoningへ引き継ぎ、LOW/MEDIUMの通常main mergeまで事前承認を保持します。`
      : `${taskIssueNumber ? `Issue #${taskIssueNumber} を新規タスクとして作成しました。` : ""}指示を受け付けました。Chat reasoningへ引き継ぎます。`
    : "確認指示を受け付けました。安全なinspectとして実行します。";

  return NextResponse.json({
    message,
    acceptedAt: new Date().toISOString(),
    taskCompletionAuthorized: Boolean(taskAuthorization),
    reasoningHandoffRequired,
    freshTaskCreated: Boolean(taskIssueNumber),
    taskIssueNumber,
  });
}
