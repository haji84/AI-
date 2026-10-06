"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { playGoriqLocalVoice } from "./jarvis/voice-output";

const suggestions = ["進めて", "状態確認", "問題だけ確認", "今日のまとめ"];
const MAX_ATTACHMENTS = 20;

type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative; length: number };
type RecognitionEventLike = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => RecognitionLike;
type SpeechWindow = Window & typeof globalThis & { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };

function recognitionConstructor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const value = window as SpeechWindow;
  return value.SpeechRecognition ?? value.webkitSpeechRecognition ?? null;
}


type ChatEntry = {
  id: string;
  role: "owner" | "ai" | "system";
  text: string;
  meta?: string;
  createdAt: string;
  attachments?: Array<{ name: string; type: string; size: number; pathname?: string }>;
};

type ConversationSummary = {
  id: number;
  title: string;
  pinned: boolean;
  project: string | null;
  createdAt: string;
  updatedAt: string;
};

type ConversationDetail = ConversationSummary & {
  messages: ChatEntry[];
  memoryContext: string;
};

type CommandStatus = {
  status: string;
  generatedAt: string | null;
  riskLevel: string | null;
  nextAction: string | null;
  verificationSummary: string | null;
  humanGateRequired: boolean;
  decisionCount: number;
  reply: string;
};

type UploadedAttachment = {
  name: string;
  type: string;
  size: number;
  pathname: string;
  readUrl: string;
  expiresAt: string;
};

function makeEntry(role: ChatEntry["role"], text: string, meta?: string, attachments?: ChatEntry["attachments"]): ChatEntry {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, role, text, meta, createdAt: new Date().toISOString(), attachments };
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

export default function CommandChat({ enabled, contextPath, compact = false }: { enabled: boolean; contextPath?: string; compact?: boolean }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [memoryContext, setMemoryContext] = useState("");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [listening, setListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const lastFingerprint = useRef<string | null>(null);
  const lastAcceptedAt = useRef<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const conversationPollTimer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const lastSeenAiId = useRef<string | null>(null);
  const lastVoiceInput = useRef(false);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((item) => !query || `${item.title} ${item.project ?? ""}`.toLowerCase().includes(query));
  }, [conversations, search]);

  async function refreshConversations() {
    if (!enabled) return;
    const response = await fetch("/api/conversations", { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as { conversations?: ConversationSummary[]; message?: string };
    if (!response.ok) throw new Error(body.message || "会話一覧の取得に失敗しました");
    setConversations(body.conversations ?? []);
  }

  async function openConversation(id: number) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/conversations?id=${id}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as Partial<ConversationDetail> & { message?: string };
      if (!response.ok || !body.id) throw new Error(body.message || "会話の取得に失敗しました");
      setConversationId(body.id);
      const messages = body.messages ?? [];
      setHistory(messages);
      setMemoryContext(body.memoryContext ?? "");
      lastSeenAiId.current = [...messages].reverse().find((entry) => entry.role === "ai")?.id ?? null;
      lastFingerprint.current = null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会話の取得に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!enabled) return;
    void refreshConversations().catch((error) => setMessage(error instanceof Error ? error.message : "会話一覧の取得に失敗しました"));
    return () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
      if (conversationPollTimer.current !== null) window.clearInterval(conversationPollTimer.current);
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; source?: "text" | "voice" }>).detail;
      const text = typeof detail?.text === "string" ? detail.text.trim() : "";
      if (!text) return;
      void send(text, detail?.source === "voice" ? "voice" : "text");
    };
    window.addEventListener("goriq-command-submit", listener);
    return () => window.removeEventListener("goriq-command-submit", listener);
  });

  async function createConversation(title: string): Promise<number> {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", title: title.slice(0, 60) || "新しい会話" }),
    });
    const body = await response.json().catch(() => ({})) as { id?: number; message?: string };
    if (!response.ok || !body.id) throw new Error(body.message || "会話の作成に失敗しました");
    setConversationId(body.id);
    setHistory([]);
    setMemoryContext("");
    await refreshConversations();
    return body.id;
  }

  async function persistEntry(id: number, entry: ChatEntry, uploaded?: UploadedAttachment[]) {
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "message",
        conversationId: id,
        role: entry.role,
        text: entry.text,
        meta: entry.meta,
        attachments: uploaded?.map((item) => ({ name: item.name, type: item.type, size: item.size, pathname: item.pathname })) ?? entry.attachments,
      }),
    });
    const body = await response.json().catch(() => ({})) as { memoryContext?: string; message?: string };
    if (!response.ok) throw new Error(body.message || "会話の保存に失敗しました");
    if (body.memoryContext) setMemoryContext(body.memoryContext);
  }

  function append(entry: ChatEntry) {
    setHistory((current) => [...current.slice(-199), entry]);
  }

  async function fetchStatus(force = false) {
    if (!enabled || checking) return;
    setChecking(true);
    try {
      const response = await fetch("/api/command", { method: "GET", cache: "no-store" });
      const body = await response.json().catch(() => ({})) as Partial<CommandStatus> & { message?: string };
      if (!response.ok) throw new Error(body.message || "最新結果の取得に失敗しました");
      const status = body as CommandStatus;
      const fingerprint = JSON.stringify([status.generatedAt, status.status, status.riskLevel, status.nextAction, status.verificationSummary, status.humanGateRequired]);
      const acceptedAt = lastAcceptedAt.current ? new Date(lastAcceptedAt.current).getTime() : 0;
      const generatedAt = status.generatedAt ? new Date(status.generatedAt).getTime() : 0;
      const isFreshForCommand = !acceptedAt || !generatedAt || generatedAt >= acceptedAt - 1500;
      if ((force || isFreshForCommand) && (force || lastFingerprint.current !== fingerprint)) {
        const meta = [`状態: ${status.status}`, `リスク: ${status.riskLevel ?? "未判定"}`, status.humanGateRequired ? `Human Gate: ${status.decisionCount}件` : "Human Gate: なし"].join(" / ");
        const entry = makeEntry("ai", status.reply, meta);
        append(entry);
        if (conversationId) await persistEntry(conversationId, entry);
        lastFingerprint.current = fingerprint;
        void refreshConversations();
      }
    } catch (error) {
      if (force) setMessage(error instanceof Error ? error.message : "最新結果の取得に失敗しました");
    } finally {
      setChecking(false);
    }
  }

  function startPolling() {
    if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    let count = 0;
    pollTimer.current = window.setInterval(() => {
      count += 1;
      void fetchStatus(false);
      if (count >= 9 && pollTimer.current !== null) {
        window.clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }, 5000);
  }

  function startConversationPolling(id: number) {
    if (conversationPollTimer.current !== null) window.clearInterval(conversationPollTimer.current);
    let count = 0;
    conversationPollTimer.current = window.setInterval(() => {
      count += 1;
      void (async () => {
        try {
          const response = await fetch(`/api/conversations?id=${id}`, { cache: "no-store" });
          const body = await response.json().catch(() => ({})) as Partial<ConversationDetail> & { message?: string };
          if (!response.ok || !body.id) return;
          const messages = body.messages ?? [];
          const latestAi = [...messages].reverse().find((entry) => entry.role === "ai") ?? null;
          setHistory(messages);
          setMemoryContext(body.memoryContext ?? "");
          if (latestAi && latestAi.id !== lastSeenAiId.current) {
            lastSeenAiId.current = latestAi.id;
            if (lastVoiceInput.current) {
              const spoken = await playGoriqLocalVoice(latestAi.text);
              setVoiceMessage(spoken.ok ? `${spoken.engine}で音声回答を再生しました` : `音声回答は再生できません: ${spoken.reason}`);
              lastVoiceInput.current = false;
            }
            if (conversationPollTimer.current !== null) {
              window.clearInterval(conversationPollTimer.current);
              conversationPollTimer.current = null;
            }
          }
        } catch {
          // Conversation polling is best-effort. Durable GitHub conversation history remains authoritative.
        }
      })();
      if (count >= 30 && conversationPollTimer.current !== null) {
        window.clearInterval(conversationPollTimer.current);
        conversationPollTimer.current = null;
      }
    }, 4000);
  }

  function stopVoiceInput() {
    recognitionRef.current?.stop();
  }

  function startVoiceInput() {
    if (busy || listening || !enabled) return;
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setVoiceMessage("このブラウザは音声入力に対応していません。文字入力はそのまま使えます。");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      setListening(true);
      setVoiceMessage("話してください。認識した文字は送信前に表示します。");
    };
    recognition.onend = () => {
      setListening(false);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      setListening(false);
      setVoiceMessage(event.error ? `音声入力に失敗しました: ${event.error}` : "音声入力に失敗しました");
    };
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript?.trim() ?? "";
        if (!text) continue;
        if (result.isFinal) finalText += `${finalText ? " " : ""}${text}`;
        else interimText += `${interimText ? " " : ""}${text}`;
      }
      const next = [command, finalText || interimText].filter(Boolean).join(command && (finalText || interimText) ? " " : "").trim();
      setCommand(next.slice(0, 500));
    };
    recognitionRef.current = recognition;
    try { recognition.start(); }
    catch (error) {
      recognitionRef.current = null;
      setListening(false);
      setVoiceMessage(error instanceof Error ? error.message : "音声入力を開始できませんでした");
    }
  }

  async function uploadAttachments(): Promise<UploadedAttachment[]> {
    const uploaded: UploadedAttachment[] = [];
    for (const file of files) {
      const response = await fetch("/api/attachments/presign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, type: file.type || "application/octet-stream", size: file.size }) });
      const body = await response.json().catch(() => ({})) as { uploadUrl?: string; attachment?: UploadedAttachment; message?: string };
      if (!response.ok || !body.uploadUrl || !body.attachment) throw new Error(body.message || `${file.name} のアップロード準備に失敗しました`);
      const uploadResponse = await fetch(body.uploadUrl, { method: "PUT", headers: { "Content-Type": body.attachment.type }, body: file });
      if (!uploadResponse.ok) throw new Error(`${file.name} のアップロードに失敗しました`);
      uploaded.push(body.attachment);
    }
    return uploaded;
  }

  async function send(value?: string) {
    const text = (value ?? command).trim();
    if (!text || busy || !enabled) return;
    setBusy(true);
    setMessage(null);
    try {
      const id = conversationId ?? await createConversation(text);
      const attachments = files.length ? await uploadAttachments() : [];
      const attachmentMeta = attachments.length ? `添付: ${attachments.map((file) => file.name).join(", ")}` : undefined;
      const ownerEntry = makeEntry("owner", text, attachmentMeta, attachments.map((item) => ({ name: item.name, type: item.type, size: item.size, pathname: item.pathname })));
      append(ownerEntry);
      await persistEntry(id, ownerEntry, attachments);

      const response = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: text, conversationId: id, memoryContext, ...(attachments.length ? { attachments } : {}) }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; acceptedAt?: string };
      if (!response.ok) throw new Error(body.message || "指示の送信に失敗しました");
      lastAcceptedAt.current = body.acceptedAt ?? new Date().toISOString();
      lastFingerprint.current = null;
      const systemEntry = makeEntry("system", body.message || "指示を受け付けました", attachments.length ? `${attachments.length}件の添付を安全な一時URLで引き渡しました` : "処理中。最新状態を自動確認します");
      append(systemEntry);
      await persistEntry(id, systemEntry);
      setCommand("");
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      await refreshConversations();
      window.setTimeout(() => void fetchStatus(false), 1800);
      startPolling();
    } catch (error) {
      const textError = error instanceof Error ? error.message : "指示の送信に失敗しました";
      const systemEntry = makeEntry("system", textError, "送信失敗");
      append(systemEntry);
      if (conversationId) void persistEntry(conversationId, systemEntry).catch(() => undefined);
      setMessage(textError);
    } finally {
      setBusy(false);
    }
  }

  async function conversationAction(action: "toggle_pin" | "set_project" | "rename", id: number) {
    const current = conversations.find((item) => item.id === id);
    const payload: Record<string, unknown> = { action, conversationId: id };
    if (action === "set_project") payload.project = window.prompt("プロジェクト名（空欄で解除）", current?.project ?? "") ?? current?.project ?? "";
    if (action === "rename") payload.title = window.prompt("会話タイトル", current?.title ?? "") ?? current?.title ?? "";
    const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok) throw new Error(body.message || "会話設定の保存に失敗しました");
    await refreshConversations();
    if (conversationId === id) await openConversation(id);
  }

  function addFiles(selected: File[]) {
    setFiles((current) => {
      const next = [...current, ...selected].slice(0, MAX_ATTACHMENTS);
      setMessage(current.length + selected.length > MAX_ATTACHMENTS ? `添付は${MAX_ATTACHMENTS}件までです` : null);
      return next;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  return (
    <div className="command-chat chat-memory-shell">
      <aside className={`chat-history-sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="chat-history-header">
          <strong>会話</strong>
          <button className="button secondary" onClick={() => { setConversationId(null); setHistory([]); setMemoryContext(""); }} type="button">＋ 新規</button>
        </div>
        <input aria-label="会話検索" className="chat-search" onChange={(event) => setSearch(event.target.value)} placeholder="会話・プロジェクトを検索" value={search} />
        <div className="chat-conversation-list">
          {filteredConversations.map((item) => (
            <div className={`chat-conversation-item ${conversationId === item.id ? "active" : ""}`} key={item.id}>
              <button className="chat-conversation-main" onClick={() => void openConversation(item.id)} type="button">
                <span>{item.pinned ? "📌 " : ""}{item.title}</span>
                <small>{item.project ? `📁 ${item.project}` : new Date(item.updatedAt).toLocaleString("ja-JP")}</small>
              </button>
              <div className="chat-conversation-actions">
                <button aria-label="ピン留め" onClick={() => void conversationAction("toggle_pin", item.id)} type="button">📌</button>
                <button aria-label="プロジェクト" onClick={() => void conversationAction("set_project", item.id)} type="button">📁</button>
                <button aria-label="タイトル変更" onClick={() => void conversationAction("rename", item.id)} type="button">✎</button>
              </div>
            </div>
          ))}
          {filteredConversations.length === 0 && <small className="inline-note">保存済み会話はまだありません。</small>}
        </div>
      </aside>

      <section className="chat-memory-main">
        <div className="chat-memory-toolbar">
          <button className="button secondary" onClick={() => setSidebarOpen((value) => !value)} type="button">{sidebarOpen ? "履歴を隠す" : "履歴を見る"}</button>
          {conversationId && <small>会話 #{conversationId} ・ 長期記憶ON</small>}
        </div>
        <div className="command-suggestions" aria-label="定型指示">
          {suggestions.map((item) => <button disabled={!enabled || busy} key={item} onClick={() => void send(item)} type="button">{item}</button>)}
        </div>

        {history.length > 0 ? (
          <div className="history-list" aria-label="AI司令チャット履歴">
            {history.map((entry) => (
              <div className={entry.role === "owner" ? "task-row" : entry.role === "ai" ? "decision-card" : "empty-state"} key={entry.id}>
                <div className="task-copy">
                  <span className="task-id">{entry.role === "owner" ? "あなた" : entry.role === "ai" ? "AI会社" : "システム"}</span>
                  <strong>{entry.text}</strong>
                  {entry.meta && <small>{entry.meta}</small>}
                  {entry.attachments?.length ? <small>📎 {entry.attachments.map((item) => item.name).join(", ")}</small> : null}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="empty-state"><strong>新しい会話</strong><small>ここから話し始めると、会話・添付・実行結果を長期保存します。</small></div>}

        <form onSubmit={submit}>
          {files.length > 0 && (
            <div className="attachment-list" aria-label="添付ファイル">
              {files.map((file, index) => (
                <div className="attachment-chip" key={`${file.name}-${file.lastModified}-${index}`}>
                  <span><strong>{file.name}</strong><small>{file.type || "形式は送信時に判定"} / {formatBytes(file.size)}</small></span>
                  <button aria-label={`${file.name}を外す`} disabled={busy} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">×</button>
                </div>
              ))}
            </div>
          )}
          <textarea aria-label="AI社員への指示" disabled={!enabled || busy} maxLength={500} onChange={(event) => setCommand(event.target.value)} placeholder="例：前の設計を引き継いで、この資料も見て完成させて" rows={3} value={command} />
          <input accept="image/*,video/*,text/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.rtf" className="attachment-input" disabled={!enabled || busy} multiple onChange={(event) => addFiles(Array.from(event.target.files ?? []))} ref={fileInput} type="file" />
          <div className="command-footer">
            <div className="command-tools">
              <button className="button secondary attachment-button" disabled={!enabled || busy || files.length >= MAX_ATTACHMENTS} onClick={() => fileInput.current?.click()} type="button">＋ 添付</button>
              <small>{command.length}/500{files.length ? ` / 添付${files.length}件` : ""}</small>
            </div>
            <div className="decision-actions">
              <button className="button secondary" disabled={!enabled || checking} onClick={() => void fetchStatus(true)} type="button">{checking ? "確認中…" : "最新の実行結果を見る"}</button>
              <button className="button command-send" disabled={!enabled || busy || !command.trim()} type="submit">{busy ? (files.length ? "アップロード中…" : "送信中…") : "指示する"}</button>
            </div>
          </div>
        </form>
        {!enabled && <p className="inline-note">この端末をオーナー認証するとAI社員へ指示できます。</p>}
        {message && <p className="control-message" role="status">{message}</p>}
        <p className="command-safety">会話はGitHubへ長期保存し、添付本体はPrivate Blobに保持します。関連する決定・制約・未完了・Issue/PR/成果物を記憶コンテキストとして次の指示へ引き継ぎます。</p>
      </section>
    </div>
  );
}
