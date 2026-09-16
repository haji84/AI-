"use client";

import { useEffect, useState } from "react";

type PairingWindow = {
  open: boolean;
  reason: "open" | "closed" | "expired" | "exhausted";
  openedAt?: string;
  expiresAt?: string;
  maxIssues: number;
  issued: number;
  remaining: number;
  group?: string;
};

type PairingResult = {
  window?: PairingWindow;
  fixedUrl?: string;
  message?: string;
  detail?: string;
};

type EnrollmentResult = {
  oneTapUrl?: string;
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
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [provisioning, setProvisioning] = useState<EnrollmentResult | null>(null);

  async function pairingAction(operation: "open" | "close" | "status") {
    setBusy(true);
    setMessage("");
    setDetail("");
    setNeedsAuth(false);
    try {
      const response = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pairing-window",
          operation,
          ttlMs: operation === "open" ? 60 * 60 * 1000 : undefined,
          maxIssues: operation === "open" ? 100 : undefined,
          group: operation === "open" ? "default" : undefined,
        }),
      });
      const body = await response.json() as PairingResult;
      if (response.status === 401) {
        setNeedsAuth(true);
        throw new Error("先にオーナー認証してください。");
      }
      if (!response.ok || !body.window) {
        setDetail(body.detail || "");
        throw new Error(body.message || "登録ウィンドウを更新できませんでした");
      }
      setPairing(body);
      if (operation === "open") setMessage("登録ウィンドウを開きました。同じ固定URLを端末ごとに1回開いてください。");
      if (operation === "close") setMessage("登録ウィンドウを閉じました。固定URLは新しい登録を発行しません。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登録ウィンドウを更新できませんでした");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void pairingAction("status");
  }, []);

  async function createProvisioningSet() {
    setBusy(true);
    setMessage("");
    setDetail("");
    setNeedsAuth(false);
    setProvisioning(null);
    try {
      const response = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enrollment",
          mode: "fleet",
          maxDevices: 100,
          ttlMs: 60 * 60 * 1000,
          group: "device-owner",
        }),
      });
      const body = await response.json() as EnrollmentResult;
      if (response.status === 401) {
        setNeedsAuth(true);
        throw new Error("先にオーナー認証してください。");
      }
      if (!response.ok) {
        setDetail(body.detail || "");
        throw new Error(body.message || "Device Owner用QRを発行できませんでした");
      }
      setProvisioning(body);
      if (!body.qrPngBase64) setMessage("Device Owner用のQRは生成準備待ちです。固定URLの既存端末登録は利用できます。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Device Owner用QRを発行できませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function copyFixedUrl() {
    if (!pairing?.fixedUrl) return;
    await navigator.clipboard.writeText(pairing.fixedUrl);
    setMessage("固定登録URLをコピーしました。受付中だけ有効です。");
  }

  async function copyProvisioning() {
    if (!provisioning?.provisioning) return;
    await navigator.clipboard.writeText(JSON.stringify(provisioning.provisioning));
    setMessage("Device Owner provisioning JSONをコピーしました。");
  }

  const window = pairing?.window;
  const statusText = !window ? "確認中" : window.open ? "受付中" : window.reason === "expired" ? "期限切れ" : window.reason === "exhausted" ? "上限到達" : "停止中";

  return <main className="dashboard-shell">
    <div className="jarvis-toolbar">
      <div>
        <p className="eyebrow">JARVIS</p>
        <h1>Android端末登録</h1>
        <p className="muted">固定URLは常設ですが、登録権限は常設しません。オーナーが受付を開いている間だけ、URLを開くたびに1台限り・最大10分の新しい登録権限を発行します。</p>
      </div>
      <div className="jarvis-button-row">
        <a className="button secondary" href="/jarvis/login?next=/jarvis/enroll">オーナー認証</a>
        <a className="button secondary" href="/jarvis">JARVISへ戻る</a>
      </div>
    </div>

    <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "32px auto 24px" }}>
      <div className="section-heading"><div><p className="section-kicker">PAIRING WINDOW</p><h2>固定URLの登録受付</h2></div><strong>{statusText}</strong></div>
      <p className="muted">1回の操作で最大100台・最長1時間の受付を開けます。受付中でも各端末へ渡る登録権限は別々で、1台限り・10分以内です。Brokerを再起動すると受付は閉じます。</p>
      {window && <div className="jarvis-alert" style={{ marginTop: 16 }}>
        <strong>{window.open ? `残り ${window.remaining} / ${window.maxIssues} 台` : `受付停止: ${statusText}`}</strong>
        {window.expiresAt && <span>終了予定: {new Date(window.expiresAt).toLocaleString("ja-JP")}</span>}
      </div>}
      <div className="jarvis-button-row" style={{ marginTop: 16 }}>
        <button className="button" disabled={busy || window?.open === true} onClick={() => void pairingAction("open")}>{busy ? "処理中..." : "最大100台の受付を開く"}</button>
        <button className="button secondary" disabled={busy || !window?.open} onClick={() => void pairingAction("close")}>受付を閉じる</button>
        <button className="button secondary" disabled={busy} onClick={() => void pairingAction("status")}>状態を更新</button>
      </div>
      {pairing?.fixedUrl && <div style={{ marginTop: 20 }}>
        <p className="muted">固定URL: <code>{pairing.fixedUrl}</code></p>
        <div className="jarvis-button-row">
          <button className="button secondary" onClick={() => void copyFixedUrl()}>固定URLをコピー</button>
          {window?.open && <a className="button" href={pairing.fixedUrl}>この端末で固定URLを開く</a>}
        </div>
      </div>}
      {message && <div className="jarvis-alert" style={{ marginTop: 16 }}><strong>{message}</strong>{detail && <span>{detail}</span>}{needsAuth && <a className="button secondary" href="/jarvis/login?next=/jarvis/enroll">オーナー認証へ</a>}</div>}
    </section>

    <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto 24px" }}>
      <div className="section-heading"><div><p className="section-kicker">使用中のAndroid</p><h2>同じ固定URLを端末ごとに開く</h2></div></div>
      <p className="muted">100台分のURLを100個作る必要はありません。受付中に同じURLを各Androidで開くと、そのアクセス専用の短命な登録Grantが作られます。URLそのものにオーナートークンやEnrollment tokenは入りません。</p>
    </section>

    <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto 24px" }}>
      <div className="section-heading"><div><p className="section-kicker">新品・初期化済みAndroid</p><h2>Device Owner QR</h2></div></div>
      <p className="muted">初回セットアップから管理端末化する場合だけ、別途Provisioning QRを発行します。これは固定URLの受付とは別経路です。</p>
      {!provisioning && <button className="button secondary" disabled={busy} onClick={() => void createProvisioningSet()}>Device Owner用QRを発行</button>}
      {provisioning?.qrPngBase64 ? <div style={{ display: "grid", gap: 18, justifyItems: "center", marginTop: 16 }}>
        <img src={`data:image/png;base64,${provisioning.qrPngBase64}`} alt="JARVIS Device Owner provisioning QR" width={320} height={320} style={{ imageRendering: "pixelated", background: "white", padding: 16, borderRadius: 16 }} />
        <p className="muted">Androidの初回セットアップ画面でQRを読み取ります。OS側の確認や対応条件は省略できません。</p>
      </div> : provisioning && <div className="jarvis-alert" style={{ marginTop: 16 }}><strong>QR生成準備待ち</strong><span>Worker APKとQR生成機能の準備状況を確認してください。</span></div>}
      {provisioning?.provisioning && <div className="jarvis-button-row" style={{ marginTop: 16 }}><button className="button secondary" onClick={() => void copyProvisioning()}>provisioning JSONをコピー</button></div>}
    </section>

    <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="section-heading"><div><p className="section-kicker">登録確認</p><h2>端末一覧へ自動反映</h2></div></div>
      <p className="muted">登録できた端末はJARVISの端末一覧へ表示されます。001〜100の管理番号はJARVIS側で割り当てます。</p>
      <a className="button secondary" href="/jarvis">端末一覧を確認</a>
    </section>
  </main>;
}
