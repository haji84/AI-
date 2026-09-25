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
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string; revoked: boolean }>>([]);

  async function refreshDevices() {
    const response = await fetch("/api/owner-login/trusted/devices", { cache: "no-store" });
    if (!response.ok) throw new Error("端末一覧を確認できません");
    const result = await response.json();
    setDevices(result.devices);
  }

  async function refresh() {
    const exists = await hasTrustedDevice();
    setTrusted(exists);
    const info = exists ? await trustedDeviceInfo() : null;
    setDeviceId(info?.id || "");
    setLabel(info?.label || (typeof navigator === "undefined" ? "操作端末" : navigator.platform || "操作端末"));
    await refreshDevices();
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
    if (!window.confirm("この端末のPINログイン資格をサーバーで失効させ、ブラウザ内の登録も削除しますか？")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/owner-login/trusted/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId }) });
      if (!response.ok) throw new Error("サーバーで失効できなかったため端末内の登録を残しました");
      await removeTrustedDevice();
      setTrusted(false);
      setMessage("この端末のPINログイン資格を失効しました。");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "失効できませんでした"); }
    finally { setBusy(false); }
  }

  async function revokeOther(target: { deviceId: string; label: string }) {
    if (!window.confirm(`${target.label} のPINログイン資格を失効させますか？`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/owner-login/trusted/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: target.deviceId }) });
      if (!response.ok) throw new Error("端末を失効できませんでした");
      await refreshDevices();
      setMessage(`${target.label} のPINログイン資格を失効しました。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "失効できませんでした"); }
    finally { setBusy(false); }
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
      <button className="button secondary" type="button" disabled={busy} onClick={remove}>この端末のPIN資格を失効</button>
    </form>}

    <div>
      <h3>登録端末</h3>
      {devices.filter(device => !device.revoked).map(device => <p key={device.deviceId}>
        {device.label} ({device.deviceId === deviceId ? "この端末" : device.deviceId}){" "}
        {device.deviceId !== deviceId && <button className="button secondary" type="button" disabled={busy} onClick={() => revokeOther(device)}>失効</button>}
      </p>)}
    </div>

    {message && <p className="jarvis-alert" role="status">{message}</p>}
    <p className="muted">失効すると次回のPINログインはできません。既にログイン済みのセッションは有効期限まで続くため、端末を紛失した場合は本番ログインコードの変更も必要です。</p>
    <p className="muted">5回連続でPINを間違えると、このブラウザでは5分間ロックします。</p>
  </section>;
}
