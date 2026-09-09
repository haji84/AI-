"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

const suggestions = ["進めて", "状態確認", "問題だけ確認", "今日のまとめ"];
const STORAGE_KEY = "ai_company_command_chat_history_v1";
const MAX_FILES = 6;
const FALLBACK_MAX_SIZE = 512 * 1024 * 1024;

type ChatEntry = {
  id: string;
  role: "owner" | "ai" | "system";
  text: string;
  meta?: string;
  createdAt: string;
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

type AttachmentReference = {
  name: string;
  contentType: string;
  size: number;
  pathname: string;
  readUrl: string;
  expiresAt: string;
};

type PrepareUploadResponse = {
  pathname?: string;
  uploadUrl?: string;
  uploadHeaders?: Record<string, string>;
  message?: string;
};

function makeEntry(role: ChatEntry["role"], text: string, meta?: string): ChatEntry {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, role, text, meta, createdAt: new Date().toISOString() };
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKind(file: File) {
  if (file.type.startsWith("image/")) return "写真";
  if (file.type.startsWith("video/")) return "動画";
  if (file.type === "application/pdf") return "PDF";
  return "ファイル";
}

async function jsonOrEmpty<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({} as T)) as Promise<T>;
}

export default function CommandChat({ enabled }: { enabled: boolean }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const [attachmentReady, setAttachmentReady] = useState<boolean | null>(null);
  const [maxAttachmentSize, setMaxAttachmentSize] = useState(FALLBACK_MAX_SIZE);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastFingerprint = useRef<string | null>(null);
  const lastAcceptedAt = useRef<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setHistory(JSON.parse(stored) as ChatEntry[]);
    } catch {
      // Ignore corrupted/local-storage failures. Chat still works in-memory.
    }
    void fetch("/api/attachments", { method: "GET", cache: "no-store" })
      .then(async (response) => {
        const body = await jsonOrEmpty<{ ready?: boolean; maxSizeBytes?: number }>(response);
        setAttachmentReady(response.ok && body.ready === true);
        if (typeof body.maxSizeBytes === "number" && body.maxSizeBytes > 0) setMaxAttachmentSize(body.maxSizeBytes);
      })
      .catch(() => setAttachmentReady(false));
    return () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-40)));
    } catch {
      // Storage is optional.
    }
  }, [history]);

  function append(entry: ChatEntry) {
    setHistory((current) => [...current.slice(-39), entry]);
  }

  async function fetchStatus(force = false) {
    if (!enabled || checking) return;
    setChecking(true);
    try {
      const response = await fetch("/api/command", { method: "GET", cache: "no-store" });
      const body = await jsonOrEmpty<Partial<CommandStatus> & { message?: string }>(response);
      if (!response.ok) throw new Error(body.message || "最新結果の取得に失敗しました");

      const status = body as CommandStatus;
      const fingerprint = JSON.stringify([
        status.generatedAt,
        status.status,
        status.riskLevel,
        status.nextAction,
        status.verificationSummary,
        status.humanGateRequired,
      ]);

      const acceptedAt = lastAcceptedAt.current ? new Date(lastAcceptedAt.current).getTime() : 0;
      const generatedAt = status.generatedAt ? new Date(status.generatedAt).getTime() : 0;
      const isFreshForCommand = !acceptedAt || !generatedAt || generatedAt >= acceptedAt - 1500;

      if ((force || isFreshForCommand) && (force || lastFingerprint.current !== fingerprint)) {
        const meta = [
          `状態: ${status.status}`,
          `リスク: ${status.riskLevel ?? "未判定"}`,
          status.humanGateRequired ? `Human Gate: ${status.decisionCount}件` : "Human Gate: なし",
        ].join(" / ");
        append(makeEntry("ai", status.reply, meta));
        lastFingerprint.current = fingerprint;
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

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length === 0) return;
    if (attachmentReady !== true) {
      setMessage("添付ストレージがまだ使えません。private Vercel Blobの接続が必要です。");
      return;
    }
    const available = Math.max(0, MAX_FILES - files.length);
    const accepted: File[] = [];
    for (const file of selected.slice(0, available)) {
      if (file.size <= 0) {
        setMessage(`${file.name} は空ファイルのため添付できません`);
        continue;
      }
      if (file.size > maxAttachmentSize) {
        setMessage(`${file.name} は${formatBytes(maxAttachmentSize)}を超えているため添付できません`);
        continue;
      }
      accepted.push(file);
    }
    if (selected.length > available) setMessage(`添付は最大${MAX_FILES}件です`);
    if (accepted.length) setFiles((current) => [...current, ...accepted].slice(0, MAX_FILES));
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function uploadFile(file: File, index: number, total: number): Promise<AttachmentReference> {
    const contentType = file.type || "application/octet-stream";
    setUploadLabel(`${index + 1}/${total} ${file.name}`);

    const prepareResponse = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prepare", name: file.name, contentType, size: file.size }),
    });
    const prepared = await jsonOrEmpty<PrepareUploadResponse>(prepareResponse);
    if (!prepareResponse.ok || !prepared.pathname || !prepared.uploadUrl || !prepared.uploadHeaders) {
      throw new Error(prepared.message || `${file.name} のアップロード準備に失敗しました`);
    }

    const uploadResponse = await fetch(prepared.uploadUrl, {
      method: "PUT",
      headers: prepared.uploadHeaders,
      body: file,
    });
    if (!uploadResponse.ok) throw new Error(`${file.name} のアップロードに失敗しました (${uploadResponse.status})`);

    const readResponse = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "authorize-read",
        name: file.name,
        contentType,
        size: file.size,
        pathname: prepared.pathname,
      }),
    });
    const readBody = await jsonOrEmpty<{ attachment?: AttachmentReference; message?: string }>(readResponse);
    if (!readResponse.ok || !readBody.attachment) {
      throw new Error(readBody.message || `${file.name} のAI参照URL発行に失敗しました`);
    }
    return readBody.attachment;
  }

  async function send(value?: string) {
    const text = (value ?? command).trim();
    if (!text || busy || !enabled) return;
    if (files.length > 0 && attachmentReady !== true) {
      setMessage("添付ストレージが未設定のため、ファイル付き指示は送れません");
      return;
    }
    setBusy(true);
    setMessage(null);
    append(makeEntry("owner", text, files.length ? `添付 ${files.length}件` : undefined));
    try {
      let attachments: AttachmentReference[] = [];
      if (files.length) {
        setUploading(true);
        attachments = await Promise.all(files.map((file, index) => uploadFile(file, index, files.length)));
      }
      setUploading(false);
      setUploadLabel(null);

      const response = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: text, ...(attachments.length ? { attachments } : {}) }),
      });
      const body = await jsonOrEmpty<{ message?: string; acceptedAt?: string }>(response);
      if (!response.ok) throw new Error(body.message || "指示の送信に失敗しました");
      lastAcceptedAt.current = body.acceptedAt ?? new Date().toISOString();
      lastFingerprint.current = null;
      append(makeEntry(
        "system",
        body.message || "指示を受け付けました",
        attachments.length ? `添付${attachments.length}件をAIへ引き継ぎました` : "処理中。最新状態を自動確認します",
      ));
      setCommand("");
      setFiles([]);
      window.setTimeout(() => void fetchStatus(false), 1800);
      startPolling();
    } catch (error) {
      const textError = error instanceof Error ? error.message : "指示の送信に失敗しました";
      append(makeEntry("system", textError, "送信失敗"));
      setMessage(textError);
    } finally {
      setUploading(false);
      setUploadLabel(null);
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  return (
    <div className="command-chat">
      <div className="command-suggestions" aria-label="定型指示">
        {suggestions.map((item) => (
          <button disabled={!enabled || busy} key={item} onClick={() => void send(item)} type="button">{item}</button>
        ))}
      </div>

      {history.length > 0 && (
        <div className="history-list" aria-label="AI司令チャット履歴">
          {history.slice(-10).map((entry) => (
            <div className={entry.role === "owner" ? "task-row" : entry.role === "ai" ? "decision-card" : "empty-state"} key={entry.id}>
              <div className="task-copy">
                <span className="task-id">{entry.role === "owner" ? "あなた" : entry.role === "ai" ? "AI会社" : "システム"}</span>
                <strong>{entry.text}</strong>
                {entry.meta && <small>{entry.meta}</small>}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit}>
        {files.length > 0 && (
          <div className="attachment-list" aria-label="選択した添付ファイル">
            {files.map((file, index) => (
              <div className="attachment-chip" key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                <span className="attachment-icon">{fileKind(file)}</span>
                <div><strong>{file.name}</strong><small>{formatBytes(file.size)}</small></div>
                <button aria-label={`${file.name}を外す`} disabled={busy} onClick={() => removeFile(index)} type="button">×</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          aria-label="AI社員への指示"
          disabled={!enabled || busy}
          maxLength={500}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="やってほしいことをそのまま入力。写真・動画・ファイルも一緒に送れます。"
          rows={3}
          value={command}
        />
        <div className="attachment-toolbar">
          <input
            aria-label="写真・動画・ファイルを選択"
            className="attachment-input"
            disabled={!enabled || busy || attachmentReady !== true}
            multiple
            onChange={selectFiles}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="attachment-button"
            disabled={!enabled || busy || attachmentReady !== true || files.length >= MAX_FILES}
            onClick={() => fileInputRef.current?.click()}
            title={attachmentReady === false ? "private Vercel Blobの接続が必要です" : "写真・動画・ファイルを添付"}
            type="button"
          >
            ＋ 添付
          </button>
          <small>{attachmentReady === null ? "添付機能を確認中…" : attachmentReady ? `最大${MAX_FILES}件・1件${formatBytes(maxAttachmentSize)}まで` : "添付ストレージ未接続"}</small>
        </div>
        <div className="command-footer">
          <small>{command.length}/500</small>
          <div className="decision-actions">
            <button className="button secondary" disabled={!enabled || checking || busy} onClick={() => void fetchStatus(true)} type="button">
              {checking ? "確認中…" : "最新の実行結果を見る"}
            </button>
            <button className="button command-send" disabled={!enabled || busy || !command.trim()} type="submit">
              {uploading ? `送信準備中…${uploadLabel ? ` ${uploadLabel}` : ""}` : busy ? "送信中…" : "指示する"}
            </button>
          </div>
        </div>
      </form>
      {!enabled && <p className="inline-note">この端末をオーナー認証するとAI社員へ指示できます。</p>}
      {message && <p className="control-message" role="status">{message}</p>}
      <p className="command-safety">添付はprivate storageへ保存し、期限付き参照でAIへ渡します。送信後45秒間は最新状態を自動確認します。HIGH操作は従来どおりHuman Gateで停止します。</p>
    </div>
  );
}
