"use client";
import { useEffect, useState } from "react";
type Invitation = { active: boolean; maxDevices: number; usedDevices: number; remaining: number; revoked: boolean };
export default function OwnerInvitationPanel() {
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(operation: "status" | "create" | "revoke") {
    setBusy(true);
    try {
      const response = await fetch("/api/jarvis/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "invitation", operation }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "招待リンクを確認できません");
      setInvitation(body.invitation);
      if (operation === "create") { setUrl(body.url); setMessage("専用リンクを発行しました。コピーして手元に保存してください。リンク全文は再表示しません。"); }
      if (operation === "revoke") { setUrl(""); setMessage("リンクを停止しました。登録済み端末は維持されます。"); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "招待リンクの処理に失敗しました"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void action("status"); }, []);
  async function copy() { try { await navigator.clipboard.writeText(url); setMessage("専用リンクをコピーしました。登録するAndroidへ渡してください。"); } catch { setMessage("コピーできませんでした。下のリンクを選択してコピーしてください。"); } }
  return <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto 24px" }}>
    <h2>USB不要・所有者専用の登録リンク</h2>
    <p>一度発行すれば、受付を毎回開かずに家のWi-Fiから登録できます。最大100台。停止するまで有効です。</p>
    <p>リンクを知る人は登録できます。公開しないでください。新規リンクの発行前に既存リンクを停止してください。</p>
    {invitation && <p>状態: {invitation.active ? "有効" : "停止中・未発行・上限到達"} ／ 登録使用数 {invitation.usedDevices}/{invitation.maxDevices}</p>}
    <div className="jarvis-button-row">
      <button className="button" disabled={busy || invitation === null || invitation.active} onClick={() => void action("create")}>専用リンクを発行</button>
      <button className="button secondary" disabled={busy || !invitation?.active} onClick={() => void action("revoke")}>リンクを停止</button>
      {url && <button className="button" onClick={() => void copy()}>登録リンクをコピー</button>}
    </div>
    {url && <input aria-label="専用登録リンク" readOnly value={url} style={{ width: "100%", marginTop: 12 }} />}
    {message && <p role="status">{message}</p>}
    <p>Androidはアプリのインストール後、同じリンクに戻って「登録する」を押してください。OSが要求する操作権限は省略できません。</p>
  </section>;
}
