"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function OwnerRecovery() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "hold">("email");
  const [unlockAt, setUnlockAt] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      await fetch("/api/owner-recovery/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setStep("code");
      setMessage("登録済みの場合は復旧メールを送信します。");
    } catch {
      setMessage("復旧要求を開始できませんでした。");
    } finally { setBusy(false); }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/owner-recovery/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "確認コードを確認できませんでした");
      setUnlockAt(typeof body.restrictedUntil === "string" ? body.restrictedUntil : "");
      setStep("hold");
      setMessage("本人確認が完了しました。安全のため復旧保護期間に入りました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "確認コードを確認できませんでした");
    } finally { setBusy(false); }
  }

  async function activate() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/owner-recovery/activate", { method: "POST", credentials: "same-origin" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "まだ復旧Sessionを開始できません");
      router.replace("/jarvis/settings");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "復旧Sessionを開始できません");
    } finally { setBusy(false); }
  }

  return <section className="panel jarvis-section" style={{ maxWidth: 560, margin: "32px auto" }}>
    <h1>PINを忘れた場合</h1>
    <p>登録済みの復旧用メールで本人確認します。メールアドレスが登録されているかどうかは画面には表示しません。</p>
    {step === "email" && <form onSubmit={start} className="jarvis-task-form">
      <label>復旧用メールアドレス</label>
      <input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} />
      <button className="button" type="submit" disabled={busy}>確認コードを送る</button>
    </form>}
    {step === "code" && <form onSubmit={verify} className="jarvis-task-form">
      <label>6桁の確認コード</label>
      <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required disabled={busy} />
      <button className="button" type="submit" disabled={busy || code.length !== 6}>本人確認</button>
    </form>}
    {step === "hold" && <div className="jarvis-task-form">
      {unlockAt && <p className="muted">保護解除予定: {new Date(unlockAt).toLocaleString("ja-JP")}</p>}
      <button className="button" type="button" onClick={activate} disabled={busy}>復旧Sessionを開始</button>
      <p className="muted">保護期間中はこの操作は拒否されます。解除後に設定画面でこの端末の4桁PINを再登録してください。</p>
    </div>}
    {message && <p className="jarvis-alert" role="status">{message}</p>}
  </section>;
}
