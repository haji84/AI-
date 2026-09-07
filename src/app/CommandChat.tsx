"use client";

import { FormEvent, useState } from "react";

const suggestions = ["進めて", "状態確認", "問題だけ確認", "今日のまとめ"];

export default function CommandChat({ enabled }: { enabled: boolean }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function send(value?: string) {
    const text = (value ?? command).trim();
    if (!text || busy || !enabled) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: text }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message || "指示の送信に失敗しました");
      setMessage(body.message || "指示を受け付けました");
      setCommand("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "指示の送信に失敗しました");
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
          <button className="button command-send" disabled={!enabled || busy || !command.trim()} type="submit">
            {busy ? "送信中…" : "指示する"}
          </button>
        </div>
      </form>
      {!enabled && <p className="inline-note">この端末をオーナー認証するとAI社員へ指示できます。</p>}
      {message && <p className="control-message" role="status">{message}</p>}
      <p className="command-safety">HIGH操作はここから直接実行されず、従来どおりHuman Gateで停止します。</p>
    </div>
  );
}
