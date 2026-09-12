"use client";

import { useState } from "react";

export default function JarvisEnrollPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [link, setLink] = useState("");

  async function createLink() {
    setBusy(true);
    setMessage("");
    setDetail("");
    setNeedsAuth(false);
    setLink("");
    try {
      const response = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enrollment", mode: "quick", maxDevices: 1 }),
      });
      const body = await response.json() as { deepLink?: string; message?: string; detail?: string };
      if (response.status === 401) {
        setNeedsAuth(true);
        throw new Error("先にオーナー認証してください。");
      }
      if (!response.ok || !body.deepLink) {
        setDetail(body.detail || "");
        throw new Error(body.message || "登録URLを発行できませんでした");
      }
      setLink(body.deepLink);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登録URLを発行できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setMessage("登録URLをコピーしました。Android端末で開いてください。");
  }

  return <main className="dashboard-shell">
    <div className="jarvis-toolbar">
      <div><p className="eyebrow">JARVIS</p><h1>端末を登録</h1><p className="muted">URLをAndroid端末で開くだけ。QRコードは不要です。</p></div>
      <div className="jarvis-button-row"><a className="button secondary" href="/jarvis/login?next=/jarvis/enroll">オーナー認証</a><a className="button secondary" href="/jarvis">JARVISへ戻る</a></div>
    </div>
    <section className="panel jarvis-section" style={{ maxWidth: 760, margin: "32px auto" }}>
      <div className="section-heading"><div><p className="section-kicker">STEP 1</p><h2>登録URLを作る</h2></div></div>
      <p className="muted">下のボタンを1回押すと、この端末専用の期限付き登録URLを発行します。</p>
      <button className="button" disabled={busy} onClick={() => void createLink()}>{busy ? "発行中..." : "登録URLを発行"}</button>
      {link && <div className="jarvis-enrollment-result" style={{ marginTop: 20 }}>
        <strong>STEP 2 このURLをAndroidで開く</strong>
        <code style={{ overflowWrap: "anywhere" }}>{link}</code>
        <div className="jarvis-button-row">
          <button className="button" onClick={() => void copyLink()}>URLをコピー</button>
          <a className="button secondary" href={link}>この端末で開く</a>
        </div>
        <p>AndroidにJARVIS Workerが入っていれば、リンクから登録画面が開きます。</p>
      </div>}
      {message && <div className="jarvis-alert" style={{ marginTop: 16 }}><strong>{message}</strong>{detail && <span>{detail}</span>}{needsAuth && <a className="button secondary" href="/jarvis/login?next=/jarvis/enroll">オーナー認証へ</a>}</div>}
    </section>
    <section className="panel jarvis-section" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="section-heading"><div><p className="section-kicker">STEP 3</p><h2>登録完了を確認</h2></div></div>
      <p className="muted">登録後はJARVISの端末一覧に自動で表示されます。複雑なBrokerやTokenの入力は不要です。</p>
      <a className="button secondary" href="/jarvis">端末一覧を確認</a>
    </section>
  </main>;
}
