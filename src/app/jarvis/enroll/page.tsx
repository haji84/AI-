"use client";

import { useEffect, useState } from "react";
import OwnerInvitationPanel from "./OwnerInvitationPanel";
import EnrollmentProgress from "./EnrollmentProgress";
import PendingRegistration from "./PendingRegistration";

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

type ReplacementCandidate = {
  candidateId: string;
  nodeId: string;
  publicKeyFingerprint: string;
  verifiedAt: string;
  expiresAt: string;
  status: "READY_FOR_HUMAN_GATE";
  requiresHumanGate: true;
};

type ReplacementReviewResult = {
  candidates?: ReplacementCandidate[];
  pendingCount?: number;
  discarded?: boolean;
  message?: string;
  detail?: string;
};

export default function JarvisEnrollPage() {
  const [busy, setBusy] = useState(false);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [provisioning, setProvisioning] = useState<EnrollmentResult | null>(null);
  const [replacementReview, setReplacementReview] = useState<ReplacementReviewResult | null>(null);
  const [replacementMessage, setReplacementMessage] = useState("");

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

  async function loadReplacementReady() {
    setReplacementBusy(true);
    setReplacementMessage("");
    try {
      const response = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replacement-ready" }),
      });
      const body = await response.json() as ReplacementReviewResult;
      if (response.status === 401) {
        setNeedsAuth(true);
        throw new Error("交換候補の確認にはオーナー認証が必要です。");
      }
      if (!response.ok) throw new Error(body.message || "交換候補を取得できませんでした");
      setReplacementReview(body);
    } catch (error) {
      setReplacementMessage(error instanceof Error ? error.message : "交換候補を取得できませんでした");
    } finally {
      setReplacementBusy(false);
    }
  }

  async function discardReplacement(candidateId: string) {
    setReplacementBusy(true);
    setReplacementMessage("");
    try {
      const response = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replacement-discard", candidateId }),
      });
      const body = await response.json() as ReplacementReviewResult;
      if (response.status === 401) {
        setNeedsAuth(true);
        throw new Error("交換候補の破棄にはオーナー認証が必要です。");
      }
      if (!response.ok || body.discarded !== true) throw new Error(body.message || "交換候補を破棄できませんでした");
      setReplacementMessage("交換候補を破棄しました。現在の端末Identityは変更していません。");
      await loadReplacementReady();
    } catch (error) {
      setReplacementMessage(error instanceof Error ? error.message : "交換候補を破棄できませんでした");
      setReplacementBusy(false);
    }
  }

  useEffect(() => {
    void pairingAction("status");
    void loadReplacementReady();
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
  const replacementCandidates = replacementReview?.candidates ?? [];

  return <main className="dashboard-shell">
    <div className="jarvis-toolbar">
      <div>
        <p className="eyebrow">JARVIS</p>
        <h1>Android端末登録</h1>
        <p className="muted">家のWi-FiでWorkerを開き、この画面からまとめて登録できます。登録後は遠隔操作一覧へ自動反映。USB不要・全体で最大100台です。</p>
      </div>
      <div className="jarvis-button-row">
        <a className="button secondary" href="/jarvis/login?next=/jarvis/enroll">オーナー認証</a>
        <a className="button secondary" href="/jarvis">JARVISへ戻る</a>
      </div>
    </div>

    <PendingRegistration />
    <details style={{ maxWidth: 860, margin: "24px auto" }}><summary>専用リンクを配って登録する場合</summary><OwnerInvitationPanel /></details>
    <EnrollmentProgress />
    <details style={{ maxWidth: 860, margin: "24px auto" }}>
      <summary>管理者向け詳細（従来の受付・新品端末・端末交換）</summary>
    <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "32px auto 24px" }}>
      <div className="section-heading"><div><p className="section-kicker">PAIRING WINDOW</p><h2>従来の時間限定受付</h2></div><strong>{statusText}</strong></div>
      <p className="muted">1回の操作で最大100台・最長1時間の受付を開けます。同じURLを各端末で開いてください。トークンと端末の認証情報は端末ごとに分かれます。トークンは最大30分、受付終了が先ならその時刻まで有効です。Brokerを再起動すると受付は閉じます。</p>
      {window && <div className="jarvis-alert" style={{ marginTop: 16 }}>
        <strong>{window.open ? `残り ${window.remaining} / ${window.maxIssues} 台` : `受付停止: ${statusText}`}</strong>
        {window.expiresAt && <span>終了予定: {new Date(window.expiresAt).toLocaleString("ja-JP")}</span>}
      </div>}
      <div className="jarvis-button-row" style={{ marginTop: 16 }}>
        <button className="button" disabled={busy || window?.open === true} onClick={() => void pairingAction("open")}>{busy ? "処理中..." : "複数台の登録を開始（最大100台）"}</button>
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
      <p className="muted">これは従来の時間限定受付を使う場合だけの手順です。通常は上の専用リンクで登録してください。アプリのインストールだけでは専用リンクの情報は渡らないため、リンク上の登録ボタンを押してください。</p>
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

    <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto 24px" }}>
      <div className="section-heading">
        <div><p className="section-kicker">DEVICE REPLACEMENT</p><h2>交換端末の本人確認待ち</h2></div>
        <strong>{replacementCandidates.length}件</strong>
      </div>
      <p className="muted">ここに出るのは、新端末が提案された秘密鍵を実際に持っていることまで確認できた候補だけです。まだ交換は完了していません。旧Identityの失効・新Identityの登録は資格情報を変更するため、別のHuman Gateが必要です。</p>
      <div className="jarvis-button-row" style={{ marginTop: 16 }}>
        <button className="button secondary" disabled={replacementBusy} onClick={() => void loadReplacementReady()}>{replacementBusy ? "確認中..." : "交換候補を更新"}</button>
      </div>
      {replacementCandidates.length === 0 ? <div className="jarvis-alert" style={{ marginTop: 16 }}>
        <strong>確認待ちの交換候補はありません</strong>
        <span>候補は短時間だけ保持され、Broker再起動でも消えます。</span>
      </div> : <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {replacementCandidates.map((candidate) => <div className="jarvis-alert" key={candidate.candidateId}>
          <strong>{candidate.nodeId} · Human Gate required</strong>
          <span>Fingerprint: <code>{candidate.publicKeyFingerprint}</code></span>
          <span>確認: {new Date(candidate.verifiedAt).toLocaleString("ja-JP")} / 期限: {new Date(candidate.expiresAt).toLocaleString("ja-JP")}</span>
          <div className="jarvis-button-row">
            <button className="button secondary" disabled={replacementBusy} onClick={() => void discardReplacement(candidate.candidateId)}>候補を破棄</button>
          </div>
        </div>)}
      </div>}
      {typeof replacementReview?.pendingCount === "number" && replacementReview.pendingCount > 0 && <p className="muted" style={{ marginTop: 12 }}>鍵所有証明待ち: {replacementReview.pendingCount}件</p>}
      {replacementMessage && <div className="jarvis-alert" style={{ marginTop: 16 }}><strong>{replacementMessage}</strong>{needsAuth && <a className="button secondary" href="/jarvis/login?next=/jarvis/enroll">オーナー認証へ</a>}</div>}
    </section>

    </details>
    <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto" }}>
      <div className="section-heading"><div><p className="section-kicker">登録確認</p><h2>端末一覧へ自動反映</h2></div></div>
      <p className="muted">登録できた端末はJARVISの端末一覧へ表示されます。001〜100の管理番号はJARVIS側で割り当てます。</p>
      <a className="button secondary" href="/jarvis">端末一覧を確認</a>
    </section>
  </main>;
}
