import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../owner-auth.ts";

const MAX_COMMAND_LENGTH = 500;

export async function POST(request: Request) {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  const githubToken = process.env.AI_COMPANY_GITHUB_TOKEN?.trim() || "";
  const repository = process.env.AI_COMPANY_GITHUB_REPOSITORY?.trim() || "haji84/AI-";
  if (!ownerSecret || !githubToken) return NextResponse.json({ message: "操作機能の設定が不足しています" }, { status: 503 });

  const cookieStore = await cookies();
  if (!verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null) as { command?: unknown } | null;
  const command = typeof payload?.command === "string" ? payload.command.trim() : "";
  if (!command) return NextResponse.json({ message: "指示を入力してください" }, { status: 400 });
  if (command.length > MAX_COMMAND_LENGTH) return NextResponse.json({ message: `指示は${MAX_COMMAND_LENGTH}文字以内で入力してください` }, { status: 400 });

  const commandPayload = {
    source: "dashboard-command-chat",
    command,
    plan: {
      kind: "user_command",
      description: "Natural-language owner command from the AI Company dashboard. Classify risk before execution and stop at Human Gate for HIGH actions.",
    },
  };

  const response = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "ai-autonomy-run",
      client_payload: { command_json: JSON.stringify(commandPayload) },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ message: `GitHubへの指示送信に失敗しました (${response.status})` }, { status: 502 });
  }

  return NextResponse.json({ message: "指示を受け付けました。安全判定後にAI社員が処理します。" });
}
