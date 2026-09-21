"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  completeTrustedDeviceRecovery,
  createTrustedDeviceRecoveryRequest,
} from "../trusted-device-client";

export default function OwnerRecovery() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code" | "hold">("email");
  const [unlockAt, setUnlockAt] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [trustedLabel, setTrustedLabel] = useState("復旧ブラウザ");
  const [trustedPin, setTrustedPin] = useState("");
  const [trustedRequest, setTrustedRequest] = useState("");
  const [trustedGrant, setTrustedGrant] = useState("");
  const [trustedMessage, setTrustedMessage] = useState("");

  useEffect(() => {
    fetch("/api/owner-recovery/activate", { credentials: "same-origin" })
      .then(async response => ({ response, body: await response.json().catch(() => ({})) }))
      .then(({ response, body }) => {
        if (!response.ok || body.recoveryLimited !== true) return;
        setStep("hold");
        setUnlockAt(typeof body.unlockAt === "string" ? body.unlockAt : "");
        setMessage(body.unlockReady === true
          ? "復旧保護期間が終了しました。復旧Sessionを開始できます。"
          : "本人確認済みです。復旧保護期間中のため保護対象操作は利用できません。");
      })
      .catch(() => undefined);
  }, []);

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

  async function createTrustedRequest(event: FormEvent) {
    event.preventDefault();
    setTrustedMessage("");
    try {
      const requestCode = await createTrustedDeviceRecoveryRequest(trustedPin, trustedLabel);
      setTrustedRequest(requestCode);
      setTrustedMessage("要求コードを作成しました。ログイン済みの別ブラウザで「設定 → 4桁PINログイン」から承認してください。");
    } catch (error) {
      setTrustedMessage(error instanceof Error ? error.message : "復旧要求コードを作成できませんでした");
    }
  }

  async function completeTrusted(event: FormEvent) {
    event.preventDefault();
    setTrustedMessage("");
    try {
      await completeTrustedDeviceRecovery(trustedGrant);
      setTrustedGrant("");
      setTrustedPin("");
      setTrustedMessage("このブラウザを信頼済み操作端末として復旧登録しました。4桁PINでログインできます。");
    } catch (error) {
      setTrustedMessage(error instanceof Error ? error.message : "信頼済み端末の復旧登録に失敗しました");
    }
  }

  return <section className="panel jarvis-section" style={{ maxWidth: 640, margin: "32px auto" }}>
    <h1>PINを忘れた場合</h1>
    <p>登録済みの復旧用メールで本人確認できます。メールアドレスが登録されているかどうかは画面には表示しません。</p>
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
      <p className="muted">保護期間中はHuman Gate承認、秘密情報・権限・本番反映、端末登録変更、遠隔操作などの通常Owner操作を許可しません。解除後に設定画面でこの端末の4桁PINを再登録してください。</p>
    </div>}
    {message && <p className="jarvis-alert" role="status">{message}</p>}

    <hr />
    <h2>ログイン済みの別ブラウザから復旧</h2>
    <p>別の信頼済み操作ブラウザへ入れる場合は、メールを使わずこのブラウザの新しい端末鍵だけを10分間承認できます。PINと秘密鍵はこのブラウザから出ません。</p>
    <form onSubmit={createTrustedRequest} className="jarvis-task-form">
      <label>このブラウザの端末名</label>
      <input value={trustedLabel} maxLength={80} onChange={event => setTrustedLabel(event.target.value)} required />
      <label>新しい4桁PIN</label>
      <input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={trustedPin} onChange={event => setTrustedPin(event.target.value.replace(/\D/g, "").slice(0, 4))} required />
      <button className="button secondary" type="submit" disabled={trustedPin.length !== 4}>復旧要求コードを作る</button>
    </form>
    {trustedRequest && <form onSubmit={completeTrusted} className="jarvis-task-form">
      <label>既存ブラウザへ渡す要求コード</label>
      <textarea rows={4} value={trustedRequest} readOnly />
      <label>既存ブラウザから返された承認コード</label>
      <textarea rows={4} value={trustedGrant} onChange={event => setTrustedGrant(event.target.value)} required />
      <button className="button" type="submit" disabled={!trustedGrant.trim()}>このブラウザの信頼登録を完了</button>
    </form>}
    {trustedMessage && <p className="jarvis-alert" role="status">{trustedMessage}</p>}
    <p><a href="/jarvis">ログインへ戻る</a></p>
  </section>;
}
