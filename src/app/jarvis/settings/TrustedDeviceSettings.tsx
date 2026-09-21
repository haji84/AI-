"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  changeTrustedDevicePin,
  enrollTrustedDevice,
  hasTrustedDevice,
  removeTrustedDevice,
  trustedDeviceInfo,
} from "../trusted-device-client";

export default function TrustedDeviceSettings() {
  const [trusted, setTrusted] = useState(false);
  const [label, setLabel] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [nextPin, setNextPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryRequest, setRecoveryRequest] = useState("");
  const [recoveryGrant, setRecoveryGrant] = useState("");
  const [grantExpiresAt, setGrantExpiresAt] = useState("");

  async function refresh() {
    const exists = await hasTrustedDevice();
    setTrusted(exists);
    const info = exists ? await trustedDeviceInfo() : null;
    setLabel(info?.label || (typeof navigator === "undefined" ? "操作端末" : navigator.platform || "操作端末"));
  }

  useEffect(() => { refresh().catch(() => undefined); }, []);

  async function enroll(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      await enrollTrustedDevice(nextPin, label || "操作端末");
      setNextPin("");
      setMessage("このブラウザを信頼済み操作端末として登録しました。次回から4桁PINでログインできます。");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "登録に失敗しました"); }
    finally { setBusy(false); }
  }

  async function changePin(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      await changeTrustedDevicePin(currentPin, nextPin);
      setCurrentPin(""); setNextPin("");
      setMessage("この端末の4桁PINを変更しました。端末固有鍵とサーバー認証資格は維持されています。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "PIN変更に失敗しました"); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm("このブラウザの信頼済み端末情報を削除しますか？本番ログインコードでは引き続きログインできます。")) return;
    setBusy(true); setMessage("");
    try {
      await removeTrustedDevice();
      setTrusted(false);
      setMessage("このブラウザの信頼済み端末情報を削除しました。");
    } finally { setBusy(false); }
  }

  async function authorizeRecovery(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(""); setRecoveryGrant(""); setGrantExpiresAt("");
    try {
      const response = await fetch("/api/owner-recovery/trusted-grant", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ requestCode: recoveryRequest.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.grant !== "string") throw new Error(body.message || "復旧登録を承認できませんでした");
      setRecoveryGrant(body.grant);
      setGrantExpiresAt(typeof body.expiresAt === "string" ? body.expiresAt : "");
      setMessage("復旧対象ブラウザ専用の承認コードを発行しました。10分以内に対象ブラウザへ戻してください。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "復旧登録を承認できませんでした");
    } finally { setBusy(false); }
  }

  return <section className="panel jarvis-settings-card">
    <div>
      <p className="eyebrow">TRUSTED OPERATOR DEVICE</p>
      <h2>4桁PINログイン</h2>
      <p>PINはサーバーへ送らず、この端末内の秘密鍵を開くためだけに使います。実際のログインは端末固有ECDSA鍵の署名で確認します。</p>
    </div>

    {!trusted ? <form onSubmit={enroll} className="jarvis-task-form">
      <label>端末名</label>
      <input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} required disabled={busy} />
      <label>使用する4桁PIN</label>
      <input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={nextPin} onChange={(event) => setNextPin(event.target.value.replace(/\D/g, "").slice(0, 4))} required disabled={busy} />
      <button className="button" type="submit" disabled={busy || nextPin.length !== 4}>この端末を信頼済みにする</button>
    </form> : <form onSubmit={changePin} className="jarvis-task-form">
      <p className="muted">登録済み: {label}</p>
      <label>現在の4桁PIN</label>
      <input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={currentPin} onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 4))} required disabled={busy} />
      <label>新しい4桁PIN</label>
      <input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={nextPin} onChange={(event) => setNextPin(event.target.value.replace(/\D/g, "").slice(0, 4))} required disabled={busy} />
      <button className="button" type="submit" disabled={busy || currentPin.length !== 4 || nextPin.length !== 4}>PINを変更</button>
      <button className="button secondary" type="button" disabled={busy} onClick={remove}>このブラウザの信頼登録を削除</button>
    </form>}

    <form onSubmit={authorizeRecovery} className="jarvis-task-form">
      <h3>別ブラウザの信頼登録を承認</h3>
      <p className="muted">復旧先ブラウザが自分で作った公開鍵だけを承認します。PINや秘密鍵は移動しません。承認コードは対象端末に固定され、10分で失効します。</p>
      <label htmlFor="jarvis-trusted-recovery-request">復旧先ブラウザの要求コード</label>
      <textarea id="jarvis-trusted-recovery-request" rows={4} value={recoveryRequest} onChange={(event) => setRecoveryRequest(event.target.value)} required disabled={busy} />
      <button className="button secondary" type="submit" disabled={busy || !recoveryRequest.trim()}>10分間だけ承認</button>
      {recoveryGrant && <>
        <label htmlFor="jarvis-trusted-recovery-grant">復旧先へ返す承認コード</label>
        <textarea id="jarvis-trusted-recovery-grant" rows={4} value={recoveryGrant} readOnly />
        {grantExpiresAt && <p className="muted">有効期限: {new Date(grantExpiresAt).toLocaleString("ja-JP")}</p>}
      </>}
    </form>

    {message && <p className="jarvis-alert" role="status">{message}</p>}
    <p className="muted">5回連続でPINを間違えると、このブラウザでは5分間ロックします。サーバー側では端末ID単位の失効リストを使えます。</p>
  </section>;
}
