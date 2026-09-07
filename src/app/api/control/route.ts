import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../owner-auth.ts";

type ControlAction = "run" | "resume" | "pause" | "status" | "test" | "preview";

const allowed = new Set<ControlAction>(["run", "resume", "pause", "status", "test", "preview"]);

function commandFor(action: ControlAction) {
  switch (action) {
    case "run":
      return { source: "dashboard", command: "次の安全な作業を進める", plan: { kind: "run", description: "Dashboard quick control: advance the next bounded safe action." } };
    case "resume":
      return { source: "dashboard", command: "停止中の作業を再開する", plan: { kind: "resume", description: "Dashboard quick control: resume bounded autonomous work." } };
    case "pause":
      return { source: "dashboard", command: "AI社員の自律作業を一時停止する", plan: { kind: "pause", description: "Dashboard quick control: pause autonomous work safely." } };
    case "status":
      return { source: "dashboard", command: "現在の状態だけ確認する", plan: { kind: "status", description: "Dashboard quick control: refresh current state without mutation." } };
    case "test":
      return { source: "dashboard", command: "安全な検証テストを実行する", plan: { kind: "inspect", description: "Dashboard quick control: run a bounded read-only verification." } };
    case "preview":
      return { source: "dashboard", command: "最新のダッシュボードPreviewを作成する", plan: { kind: "preview", description: "Dashboard quick control: request Preview-only deployment. Production is not authorized." } };
  }
}

export async function POST(request: Request) {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  const githubToken = process.env.AI_COMPANY_GITHUB_TOKEN?.trim() || "";
  const repository = process.env.AI_COMPANY_GITHUB_REPOSITORY?.trim() || "haji84/AI-";
  if (!ownerSecret || !githubToken) return NextResponse.json({ message: "操作機能の設定が不足しています" }, { status: 503 });

  const cookieStore = await cookies();
  if (!verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null) as { action?: string } | null;
  const action = payload?.action as ControlAction | undefined;
  if (!action || !allowed.has(action)) return NextResponse.json({ message: "未対応の操作です" }, { status: 400 });

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
      client_payload: { command_json: JSON.stringify(commandFor(action)) },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ message: `GitHub操作に失敗しました (${response.status})` }, { status: 502 });
  }

  return NextResponse.json({
    message: action === "preview"
      ? "Preview作成を依頼しました。Productionは実行しません。"
      : "操作を受け付けました。AI社員の状態を更新します。",
  });
}
