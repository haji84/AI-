"use client";
import { useEffect, useState } from "react";
import { WORKER_APK } from "../../../jarvis/invitation-link";

type Pending = { id: string; label: string; code: string; expiresAt: number };
export default function PendingRegistration() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/jarvis/action", { method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pending-enrollment" }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "登録待ちを確認できません");
        if (!stopped) setPending(body.pending);
      } catch (error) { if (!stopped) setMessage(error instanceof Error ? error.message : "接続を確認してください"); }
      finally { if (!stopped) timer = setTimeout(refresh, 3_000); }
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); abort.abort(); };
  }, []);
  const ids = selected.filter(id => pending.some(item => item.id === id));
  async function register() {
    setBusy(true);
    try {
      const response = await fetch("/api/jarvis/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pending-enrollment", ids }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "登録できませんでした");
      setPending(body.pending); setSelected([]);
      setMessage(`${body.enrolled.length}台を登録しました。端末が接続すると遠隔操作できます。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "登録できませんでした"); }
    finally { setBusy(false); }
  }
  return <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto 24px" }}>
    <h2>Androidをまとめて登録</h2>
    <a className="button secondary" href={WORKER_APK} rel="noreferrer">Android用Workerをインストール・更新</a>
    <ol><li>Androidを家のWi-Fiにつなぎ、Worker 0.4.3以降を開く</li><li>下の端末名・確認コードを確認して登録する</li></ol>
    <p>USB・受付の開始・登録リンクの開き直しは不要です。登録した端末は遠隔一覧へ自動で追加されます。</p>
    <p>登録待ち {pending.length}台。確認コードはAndroidにも表示されます。自分の端末だけ選んでください。</p>
    <ul>{pending.map(item => <li key={item.id}><label><input type="checkbox" disabled={busy} checked={ids.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current.filter(id => id !== item.id), item.id] : current.filter(id => id !== item.id))} />{item.label} · 確認コード {item.code}</label></li>)}</ul>
    <div className="jarvis-button-row">
      <button className="button secondary" disabled={busy || !pending.length} onClick={() => setSelected(pending.map(item => item.id))}>表示中の端末をすべて選択</button>
      <button className="button" disabled={busy || !ids.length} onClick={() => void register()}>{busy ? "登録中…" : `選択した${ids.length}台を登録`}</button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
