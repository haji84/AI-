"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { safeOwnerReturnPath } from "../owner-login-redirect.ts";
import { hasTrustedDevice, signInWithTrustedPin } from "./trusted-device-client";

export default function OwnerLogin({ next = "/jarvis", initialError = false }: { next?: string; initialError?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [trustedReady, setTrustedReady] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(initialError ? "認証コードを確認してください。" : "");

  useEffect(() => {
    hasTrustedDevice().then(setTrustedReady).catch(() => setTrustedReady(false));
  }, []);

  async function finishLogin() {
    const target = safeOwnerReturnPath(next);
    if (window.location.pathname !== target) router.replace(target);
    router.refresh();
  }

  async function submitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await signInWithTrustedPin(pin);
      setPin("");
      await finishLogin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PINログインに失敗しました");
    } finally { setBusy(false); }
  }

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
      await finishLogin();
    } catch {
      setError("JARVISとの通信に失敗しました。接続を確認して、もう一度ログインしてください。");
    } finally { setBusy(false); }
  }

  return <section className="panel jarvis-section" style={{ maxWidth: 560, margin: "32px auto" }}>
    <h1>JARVISにログイン</h1>
    <p>信頼済み端末では4桁PINで入れます。PINはこの端末の鍵を開くためだけに使われ、サーバーへ送信されません。</p>

    {trustedReady && <>
      <form onSubmit={submitPin} className="jarvis-task-form">
        <label htmlFor="jarvis-owner-pin">4桁PIN</label>
        <input
          id="jarvis-owner-pin"
          name="pin"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          autoComplete="off"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
          required
          disabled={busy}
        />
        <button className="button" type="submit" disabled={busy || pin.length !== 4}>{busy ? "確認中…" : "PINでログイン"}</button>
      </form>
      <p className="muted">PINが使えない場合は下の本番ログインコードで入れます。</p>
    </>}

    <form onSubmit={submit} action="/api/owner-login" method="post" className="jarvis-task-form">
      <input type="hidden" name="next" value={safeOwnerReturnPath(next)} />
      <label htmlFor="jarvis-owner-code">{trustedReady ? "本番ログインコード（予備）" : "本番ログインコード"}</label>
      <input id="jarvis-owner-code" name="passcode" type="password" autoComplete="current-password" required disabled={busy} />
      <button className="button" type="submit" disabled={busy}>{busy ? "接続中…" : "ログインして遠隔操作へ"}</button>
    </form>
    {error && <p className="jarvis-alert" role="alert">{error}</p>}
    <p className="muted">信頼済み端末の登録やPIN変更は、ログイン後の「設定」から行えます。</p>
    <p><a href="/jarvis/recover">PINを忘れた場合</a></p>
  </section>;
}
