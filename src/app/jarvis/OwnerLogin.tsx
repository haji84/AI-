"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { safeOwnerReturnPath } from "../owner-login-redirect.ts";

export default function OwnerLogin({ next = "/jarvis", initialError = false }: { next?: string; initialError?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ? "認証コードを確認してください。" : "");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/owner-login", {
        method: "POST", body: new FormData(form), credentials: "same-origin",
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        setError(response.status === 401 ? "認証コードが違います。PCに表示された本番コードを確認してください。" : "ログインできませんでした。少し待って再試行してください。");
        return;
      }
      form.reset();
      const target = safeOwnerReturnPath(next);
      if (window.location.pathname !== target) router.replace(target);
      router.refresh();
    } catch {
      setError("JARVISとの通信に失敗しました。接続を確認して、もう一度ログインしてください。");
    } finally { setBusy(false); }
  }
  return <section className="panel jarvis-section" style={{ maxWidth: 560, margin: "32px auto" }}>
    <h1>JARVISにログイン</h1>
    <p>この入口から、端末一覧・遠隔操作・手順記録を使えます。通常はこのブラウザで初回だけログインします。</p>
    <form onSubmit={submit} action="/api/owner-login" method="post" className="jarvis-task-form">
      <input type="hidden" name="next" value={safeOwnerReturnPath(next)} />
      <label htmlFor="jarvis-owner-code">本番ログインコード</label>
      <input id="jarvis-owner-code" name="passcode" type="password" autoComplete="current-password" required disabled={busy} />
      <button className="button" type="submit" disabled={busy}>{busy ? "接続中…" : "ログインして遠隔操作へ"}</button>
    </form>
    {error && <p className="jarvis-alert" role="alert">{error}</p>}
    <p className="muted">ZBookに表示されたJARVISの本番コードを入力してください。WindowsのパスワードやPINとは別です。</p>
  </section>;
}
