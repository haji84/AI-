"use client";

import { useState } from "react";

type EnrollmentResult = {
  deepLink?: string;
  apkUrl?: string;
  qrPngBase64?: string;
  provisioning?: Record<string, unknown>;
  message?: string;
  detail?: string;
};

export default function JarvisEnrollPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [result, setResult] = useState<EnrollmentResult | null>(null);

  async function createEnrollmentSet() {
    setBusy(true);
    setMessage("");
    setDetail("");
    setNeedsAuth(false);
    setResult(null);
    try {
      const response = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enrollment",
          mode: "fleet",
          maxDevices: 100,
          ttlMs: 60 * 60 * 1000,
          group: "default",
        }),
      });
      const body = await response.json() as EnrollmentResult;
      if (response.status === 401) {
        setNeedsAuth(true);
        throw new Error("先にオーナー認証してください。");
      }
      if (!response.ok || !body.deepLink) {
        setDetail(body.detail || "");
        throw new Error(body.message || "登録セットを発行できませんでした");
      }
      setResult(body);
      if (!body.apkUrl) setMessage("Worker APKの準備待ちです。Mac側のAndroidビルド完了後に再発行してください。");
      else if (!body.qrPngBase64) setMessage("既存端末用リンクは使えます。新品端末用QRはMac側のQR生成準備待ちです。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登録セットを発行できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function copyDeepLink() {
    if (!result?.deepLink) return;
    await navigator.clipboard.writeText(result.deepLink);
    setMessage("100台共通の登録リンクをコピーしました。");
  }

  async function copyProvisioning() {
    if (!result?.provisioning) return;
    await navigator.clipboard.writeText(JSON.stringify(result.provisioning));
    setMessage("Device Owner provisioning JSONをコピーしました。");
  }

  return <main className="dashboard-shell">
    <div className="jarvis-toolbar">
      <div>
        <p className="eyebrow">JARVIS</p>
        <h1>Androidをまとめて登録</h1>
        <p className="muted">USB不要。1回発行した登録セットで、使用中端末と新品・初期化端末の両方を登録できます。</p>
      </div>
      <div className="jarvis-button-row">
        <a className="button secondary" href="/jarvis/login?next=/jarvis/enroll">オーナー認証</a>
        <a className="button secondary" href="/jarvis">JARVISへ戻る</a>
      </div>
    </div>

    <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "32px auto" }}>
      <div className="section-heading"><div><p className="section-kicker">STEP 1</p><h2>100台共通の登録セットを発行</h2></div></div>
      <p className="muted">有効時間は1時間。最大100台まで同じ登録セットを使えます。期限が切れたら再発行するだけです。</p>
      <button className="button" disabled={busy} onClick={() => void createEnrollmentSet()}>{busy ? "発行中..." : "100台登録セットを発行"}</button>
      {message && <div className="jarvis-alert" style={{ marginTop: 16 }}><strong>{message}</strong>{detail && <span>{detail}</span>}{needsAuth && <a className="button secondary" href="/jarvis/login?next=/jarvis/enroll">オーナー認証へ</a>}</div>}
    </section>

    {result && <>
      <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto 24px" }}>
        <div className="section-heading"><div><p className="section-kicker">使用中のAndroid</p><h2>初期化せず登録</h2></div></div>
        <p className="muted">端末ごとにUSB接続する必要はありません。Workerを入れて、同じ登録リンクを開きます。</p>
        <div className="jarvis-button-row">
          {result.apkUrl && <a className="button" href={result.apkUrl}>① JARVIS Worker APKを入れる</a>}
          {result.deepLink && <a className="button" href={result.deepLink}>② この端末をJARVISへ登録</a>}
          <button className="button secondary" onClick={() => void copyDeepLink()}>登録リンクをコピー</button>
        </div>
        <p className="muted" style={{ marginTop: 16 }}>APKの初回インストール時はAndroid側で「この提供元を許可」が必要になる場合があります。これはAndroid標準の確認です。</p>
      </section>

      <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto 24px" }}>
        <div className="section-heading"><div><p className="section-kicker">新品・初期化済みAndroid</p><h2>QR一発でDevice Owner登録</h2></div></div>
        {result.qrPngBase64 ? <div style={{ display: "grid", gap: 18, justifyItems: "center" }}>
          <img src={`data:image/png;base64,${result.qrPngBase64}`} alt="JARVIS Device Owner provisioning QR" width={320} height={320} style={{ imageRendering: "pixelated", background: "white", padding: 16, borderRadius: 16 }} />
          <p className="muted">Androidの初回セットアップ画面でこのQRを読み取ると、Worker取得・Device Owner化・JARVIS登録まで進みます。</p>
        </div> : <div className="jarvis-alert"><strong>QR生成準備待ち</strong><span>Mac側でWorker APKとQR生成機能が準備できるとここにQRが表示されます。</span></div>}
        {result.provisioning && <div className="jarvis-button-row" style={{ marginTop: 16 }}><button className="button secondary" onClick={() => void copyProvisioning()}>provisioning JSONをコピー</button></div>}
      </section>

      <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto" }}>
        <div className="section-heading"><div><p className="section-kicker">STEP 3</p><h2>登録確認</h2></div></div>
        <p className="muted">登録できた端末はJARVISの端末一覧へ自動表示されます。001〜100の管理番号付与はJARVIS側で行います。</p>
        <a className="button secondary" href="/jarvis">端末一覧を確認</a>
      </section>
    </>}
  </main>;
}
