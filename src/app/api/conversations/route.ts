import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildMemoryContext,
  decodeChatComment,
  decodeConversationBody,
  defaultConversationMeta,
  encodeChatComment,
  encodeConversationBody,
  evolveMemory,
  type PersistedChatMessage,
} from "../../chat-memory.ts";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "../../owner-auth.ts";

const CHAT_PREFIX = "[AI Chat] ";

async function ownerContext() {
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  const githubToken = process.env.AI_COMPANY_GITHUB_TOKEN?.trim() || "";
  const repository = process.env.AI_COMPANY_GITHUB_REPOSITORY?.trim() || "haji84/AI-";
  if (!ownerSecret || !githubToken) return { error: NextResponse.json({ message: "操作機能の設定が不足しています" }, { status: 503 }) };
  const cookieStore = await cookies();
  if (!verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value)) {
    return { error: NextResponse.json({ message: "オーナー認証が必要です" }, { status: 401 }) };
  }
  return { githubToken, repository };
}

function headers(token: string) {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
}

async function readConversation(repository: string, token: string, id: number) {
  const [issueResponse, commentsResponse] = await Promise.all([
    fetch(`https://api.github.com/repos/${repository}/issues/${id}`, { headers: headers(token), cache: "no-store" }),
    fetch(`https://api.github.com/repos/${repository}/issues/${id}/comments?per_page=100`, { headers: headers(token), cache: "no-store" }),
  ]);
  if (!issueResponse.ok || !commentsResponse.ok) throw new Error("会話の取得に失敗しました");
  const issue = await issueResponse.json() as { number: number; title: string; body?: string | null; created_at: string; updated_at: string };
  if (!issue.title.startsWith(CHAT_PREFIX)) throw new Error("指定された会話はAI Chat会話ではありません");
  const comments = await commentsResponse.json() as Array<{ body?: string | null }>;
  const messages = comments.map((comment) => decodeChatComment(comment.body)).filter((value): value is PersistedChatMessage => value !== null);
  const meta = decodeConversationBody(issue.body);
  return {
    id: issue.number,
    title: issue.title.slice(CHAT_PREFIX.length),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    pinned: meta.pinned,
    project: meta.project,
    memory: meta.memory,
    memoryContext: buildMemoryContext(meta, messages),
    messages,
  };
}

export async function GET(request: Request) {
  const context = await ownerContext();
  if ("error" in context) return context.error;
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id") || 0);
  try {
    if (Number.isInteger(id) && id > 0) return NextResponse.json(await readConversation(context.repository, context.githubToken, id), { headers: { "Cache-Control": "no-store" } });
    const response = await fetch(`https://api.github.com/repos/${context.repository}/issues?state=all&sort=updated&direction=desc&per_page=100`, { headers: headers(context.githubToken), cache: "no-store" });
    if (!response.ok) throw new Error("会話一覧の取得に失敗しました");
    const issues = await response.json() as Array<{ number: number; title: string; body?: string | null; created_at: string; updated_at: string; pull_request?: unknown }>;
    const items = issues.filter((issue) => !issue.pull_request && issue.title.startsWith(CHAT_PREFIX)).map((issue) => {
      const meta = decodeConversationBody(issue.body);
      return { id: issue.number, title: issue.title.slice(CHAT_PREFIX.length), createdAt: issue.created_at, updatedAt: issue.updated_at, pinned: meta.pinned, project: meta.project, memory: meta.memory };
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    return NextResponse.json({ conversations: items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "会話の取得に失敗しました" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const context = await ownerContext();
  if ("error" in context) return context.error;
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof payload?.action === "string" ? payload.action : "";
  try {
    if (action === "create") {
      const rawTitle = typeof payload?.title === "string" ? payload.title.trim() : "";
      const title = (rawTitle || "新しい会話").slice(0, 90);
      const project = typeof payload?.project === "string" && payload.project.trim() ? payload.project.trim().slice(0, 80) : null;
      const meta = { ...defaultConversationMeta(), project };
      const response = await fetch(`https://api.github.com/repos/${context.repository}/issues`, {
        method: "POST", headers: headers(context.githubToken), body: JSON.stringify({ title: `${CHAT_PREFIX}${title}`, body: encodeConversationBody(meta) }),
      });
      const issue = await response.json().catch(() => null) as { number?: number; message?: string } | null;
      if (!response.ok || !issue?.number) throw new Error(issue?.message || "会話の作成に失敗しました");
      return NextResponse.json({ id: issue.number, title, pinned: false, project, messages: [], memory: meta.memory, memoryContext: "" });
    }

    const id = Number(payload?.conversationId || 0);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ message: "会話IDが不正です" }, { status: 400 });
    const conversation = await readConversation(context.repository, context.githubToken, id);

    if (action === "message") {
      const role = payload?.role;
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (!text || !["owner", "ai", "system"].includes(String(role))) return NextResponse.json({ message: "会話メッセージが不正です" }, { status: 400 });
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments.slice(0, 20).map((item) => {
        const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return { name: String(value.name ?? "file").slice(0, 180), type: String(value.type ?? "application/octet-stream").slice(0, 160), size: Number(value.size ?? 0), pathname: typeof value.pathname === "string" ? value.pathname.slice(0, 300) : undefined };
      }) : undefined;
      const message: PersistedChatMessage = { id: randomUUID(), role: role as PersistedChatMessage["role"], text: text.slice(0, 8000), meta: typeof payload?.meta === "string" ? payload.meta.slice(0, 1000) : undefined, createdAt: new Date().toISOString(), attachments };
      const comment = await fetch(`https://api.github.com/repos/${context.repository}/issues/${id}/comments`, { method: "POST", headers: headers(context.githubToken), body: JSON.stringify({ body: encodeChatComment(message) }) });
      if (!comment.ok) throw new Error("会話の保存に失敗しました");
      const currentMeta = { version: 1 as const, pinned: conversation.pinned, project: conversation.project, memory: conversation.memory };
      const nextMeta = evolveMemory(currentMeta, message);
      await fetch(`https://api.github.com/repos/${context.repository}/issues/${id}`, { method: "PATCH", headers: headers(context.githubToken), body: JSON.stringify({ body: encodeConversationBody(nextMeta) }) });
      return NextResponse.json({ message, memory: nextMeta.memory, memoryContext: buildMemoryContext(nextMeta, [...conversation.messages, message]) });
    }

    if (["toggle_pin", "set_project", "rename"].includes(action)) {
      const meta = { version: 1 as const, pinned: conversation.pinned, project: conversation.project, memory: conversation.memory };
      if (action === "toggle_pin") meta.pinned = !meta.pinned;
      if (action === "set_project") meta.project = typeof payload?.project === "string" && payload.project.trim() ? payload.project.trim().slice(0, 80) : null;
      const patch: Record<string, unknown> = { body: encodeConversationBody(meta) };
      if (action === "rename") {
        const title = typeof payload?.title === "string" ? payload.title.trim().slice(0, 90) : "";
        if (!title) return NextResponse.json({ message: "タイトルを入力してください" }, { status: 400 });
        patch.title = `${CHAT_PREFIX}${title}`;
      }
      const response = await fetch(`https://api.github.com/repos/${context.repository}/issues/${id}`, { method: "PATCH", headers: headers(context.githubToken), body: JSON.stringify(patch) });
      if (!response.ok) throw new Error("会話設定の保存に失敗しました");
      return NextResponse.json({ ok: true, pinned: meta.pinned, project: meta.project });
    }

    return NextResponse.json({ message: "未対応の会話操作です" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "会話操作に失敗しました" }, { status: 502 });
  }
}
