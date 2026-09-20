"use client";

import { useEffect, useState, type FormEvent } from "react";

export default function RecoveryEmailSettings() {
  const [configured, setConfigured] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/owner-recovery", { credentials: "same-origin" })
      .then(async response => response.ok ? response.json() : null)
      .then(body => {
        if (!body) return;
        setConfigured(body.configured === true);
        setMaskedEmail(typeof body.maskedEmail === "string" ? body.maskedEmail : "");
      })
      .catch(() => undefined);
  }, []);

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/owner-recovery", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register-start", email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "確認メールを送信できませんでした");
      setStep("code");
      setMessage("確認コードを送信しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "確認メールを送信できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/owner-recovery", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register-verify", code }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "確認コードを確認できませんでした");
      setConfigured(true);
      setMaskedEmail(typeof body.maskedEmail === "string" ? body.maskedEmail : "");
      setCode("");
      setEmail("");
      setStep("email");
      setMessage("復旧用メールを確認して登録しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "確認コードを確認できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel jarvis-settings-card">
    <div>
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h2>復旧用メール</h2>
      <p>入力しただけでは登録されません。届いた6桁コードを確認して初めて復旧先として有効になります。</p>
      {configured && <p className="muted">登録済み: {maskedEmail || "確認済み"}</p>}
    </div>
    {step === "email" ? <form onSubmit={start} className="jarvis-task-form">
      <label>復旧用メールアドレス</label>
      <input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} />
      <button className="button" type="submit" disabled={busy}>確認コードを送る</button>
    </form> : <form onSubmit={verify} className="jarvis-task-form">
      <label>6桁の確認コード</label>
      <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required disabled={busy} />
      <button className="button" type="submit" disabled={busy || code.length !== 6}>復旧用メールを確定</button>
    </form>}
    {message && <p className="jarvis-alert" role="status">{message}</p>}
  </section>;
}
