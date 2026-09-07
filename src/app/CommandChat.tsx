"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const suggestions = ["進めて", "状態確認", "問題だけ確認", "今日のまとめ"];
const STORAGE_KEY = "ai_company_command_chat_history_v1";

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

function makeEntry(role: ChatEntry["role"], text: string, meta?: string): ChatEntry {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, role, text, meta, createdAt: new Date().toISOString() };
}

export default function CommandChat({ enabled }: { enabled: boolean }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatEntry[]>([]);
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
      const body = await response.json().catch(() => ({})) as Partial<CommandStatus> & { message?: string };
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

  async function send(value?: string) {
    const text = (value ?? command).trim();
    if (!text || busy || !enabled) return;
    setBusy(true);
    setMessage(null);
    append(makeEntry("owner", text));
    try {
      const response = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: text }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string; acceptedAt?: string };
      if (!response.ok) throw new Error(body.message || "指示の送信に失敗しました");
      lastAcceptedAt.current = body.acceptedAt ?? new Date().toISOString();
      lastFingerprint.current = null;
      append(makeEntry("system", body.message || "指示を受け付けました", "処理中。最新状態を自動確認します"));
      setCommand("");
      window.setTimeout(() => void fetchStatus(false), 1800);
      startPolling();
    } catch (error) {
      const textError = error instanceof Error ? error.message : "指示の送信に失敗しました";
      append(makeEntry("system", textError, "送信失敗"));
      setMessage(textError);
    } finally {
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
        <textarea
          aria-label="AI社員への指示"
          disabled={!enabled || busy}
          maxLength={500}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="例：Issue #78の現在地を確認して、次の安全な作業まで進めて"
          rows={3}
          value={command}
        />
        <div className="command-footer">
          <small>{command.length}/500</small>
          <div className="decision-actions">
            <button className="button secondary" disabled={!enabled || checking} onClick={() => void fetchStatus(true)} type="button">
              {checking ? "確認中…" : "最新結果を確認"}
            </button>
            <button className="button command-send" disabled={!enabled || busy || !command.trim()} type="submit">
              {busy ? "送信中…" : "指示する"}
            </button>
          </div>
        </div>
      </form>
      {!enabled && <p className="inline-note">この端末をオーナー認証するとAI社員へ指示できます。</p>}
      {message && <p className="control-message" role="status">{message}</p>}
      <p className="command-safety">送信後45秒間は最新状態を自動確認します。HIGH操作は従来どおりHuman Gateで停止します。</p>
    </div>
  );
}
