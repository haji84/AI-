"use client";

import { useCallback, useEffect, useState } from "react";

type RemoteDevice = { serial: string; state: string };
type QaRun = {
  id: string;
  serial: string;
  status: "queued" | "running" | "done" | "error-no-retry" | "step1-timeout" | "step2-timeout" | "failed";
  stage: string;
  step: 1 | 2;
  matched: string[];
  appClosed: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

const TERMINAL = new Set(["done", "error-no-retry", "step1-timeout", "step2-timeout", "failed"]);

function statusLabel(run: QaRun | null): string {
  if (!run) return "待機中";
  if (run.status === "done") return "完了・アプリ終了済み";
  if (run.status === "error-no-retry") return "エラー検出・再実行なし";
  if (run.status === "step1-timeout") return "URL① 判定タイムアウト";
  if (run.status === "step2-timeout") return "URL② 判定タイムアウト";
  if (run.status === "failed") return "実行失敗";
  if (run.stage === "opening-step1") return "URL①を開いています";
  if (run.stage === "waiting-step1") return "URL①の成功画面を確認中";
  if (run.stage === "opening-step2") return "URL①成功 → URL②を開いています";
  if (run.stage === "waiting-step2") return "URL②の受取完了画面を確認中";
  if (run.stage === "closing-app") return "URL②成功 → アプリを終了中";
  return "処理中";
}

export default function QaSequenceConsole() {
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [serial, setSerial] = useState("");
  const [url1, setUrl1] = useState("");
  const [url2, setUrl2] = useState("");
  const [packageName, setPackageName] = useState("");
  const [run, setRun] = useState<QaRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadDevices = useCallback(async () => {
    try {
      const response = await fetch("/api/jarvis/remote", { cache: "no-store" });
      const body = await response.json() as { devices?: RemoteDevice[]; message?: string };
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      const next = body.devices ?? [];
      setDevices(next);
      setSerial((current) => current && next.some((item) => item.serial === current) ? current : next[0]?.serial ?? "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Remote Gatewayに接続できません");
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    const saved = window.localStorage.getItem("jarvis.qa.profile");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { url1?: string; url2?: string; packageName?: string };
        setUrl1(parsed.url1 ?? "");
        setUrl2(parsed.url2 ?? "");
        setPackageName(parsed.packageName ?? "");
      } catch {
        window.localStorage.removeItem("jarvis.qa.profile");
      }
    }
  }, [loadDevices]);

  useEffect(() => {
    window.localStorage.setItem("jarvis.qa.profile", JSON.stringify({ url1, url2, packageName }));
  }, [url1, url2, packageName]);

  const fetchRun = useCallback(async (runId: string) => {
    const response = await fetch("/api/jarvis/remote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "qa-sequence-status", runId }),
    });
    const body = await response.json() as { run?: QaRun; message?: string };
    if (!response.ok || !body.run) throw new Error(body.message || `HTTP ${response.status}`);
    setRun(body.run);
    return body.run;
  }, []);

  useEffect(() => {
    if (!run || TERMINAL.has(run.status)) return;
    const timer = window.setInterval(() => {
      void fetchRun(run.id).catch((cause) => setError(cause instanceof Error ? cause.message : "状態確認に失敗しました"));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [run, fetchRun]);

  async function start() {
    if (!serial || !url1 || !url2 || !packageName) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/jarvis/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "qa-sequence-start",
          serial,
          url1,
          url2,
          packageName,
          timeoutMs: 90000,
          pollMs: 1500,
        }),
      });
      const body = await response.json() as { run?: QaRun; message?: string };
      if (!response.ok || !body.run) throw new Error(body.message || `HTTP ${response.status}`);
      setRun(body.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "QAシーケンスを開始できません");
    } finally {
      setBusy(false);
    }
  }

  const terminal = run ? TERMINAL.has(run.status) : false;
  const failed = run && run.status !== "done" && terminal;

  return (
    <div className="jarvis-console">
      <div className="jarvis-toolbar">
        <div>
          <p className="eyebrow">JARVIS QA SEQUENCE</p>
          <h1>2 URL 自動判定</h1>
          <p className="muted">URL①成功を確認してからURL②へ。指定エラーは再実行せず停止し、URL②成功後だけ対象アプリを閉じます。</p>
        </div>
        <div className="jarvis-toolbar-actions"><a className="button secondary" href="/jarvis">Fleet Consoleへ戻る</a></div>
      </div>

      {error && <div className="jarvis-alert"><strong>状態</strong><span>{error}</span></div>}

      <section className="panel jarvis-section">
        <div className="section-heading"><div><p className="section-kicker">TARGET</p><h2>実行設定</h2></div></div>
        <div className="jarvis-task-form">
          <select value={serial} onChange={(event) => setSerial(event.target.value)} disabled={!!run && !terminal}>
            <option value="">Android端末を選択</option>
            {devices.map((device) => <option value={device.serial} key={device.serial}>{device.serial} ({device.state})</option>)}
          </select>
          <input type="url" pattern="https://.*" placeholder="URL①" value={url1} onChange={(event) => setUrl1(event.target.value)} disabled={!!run && !terminal} />
          <input type="url" pattern="https://.*" placeholder="URL②" value={url2} onChange={(event) => setUrl2(event.target.value)} disabled={!!run && !terminal} />
        </div>
        <div className="jarvis-task-form" style={{ marginTop: 8 }}>
          <input placeholder="Android packageName 例: com.example.app" value={packageName} onChange={(event) => setPackageName(event.target.value)} disabled={!!run && !terminal} />
          <button className="button secondary" disabled={busy || !serial || !url1 || !url2 || !packageName || (!!run && !terminal)} onClick={() => void start()}>この端末で開始</button>
          <button className="button secondary" disabled={busy} onClick={() => void loadDevices()}>端末更新</button>
        </div>
        <p className="muted">設定はこのブラウザに保存されるので、同じURL・アプリなら次回の再入力は不要です。</p>
      </section>

      <section className="panel jarvis-section">
        <div className="section-heading"><div><p className="section-kicker">LIVE STATUS</p><h2>{statusLabel(run)}</h2></div>{run && <span className={`count-badge ${failed ? "" : "neutral"}`}>{run.status}</span>}</div>
        {!run ? <p className="jarvis-empty">まだ実行していません。</p> : <div className="jarvis-enrollment-result">
          <strong>端末 {run.serial}</strong>
          <small>現在 Step {run.step} / stage: {run.stage}</small>
          {run.matched.length > 0 && <small>検出: {run.matched.join(" / ")}</small>}
          {run.error && <small>エラー: {run.error}</small>}
          {run.status === "error-no-retry" && <p>指定エラー画面を検出したため、このURLは押し直していません。次URLにも進んでいません。</p>}
          {run.status === "done" && <p>URL① → URL② の成功確認が完了し、対象アプリを終了しました。</p>}
          {(run.status === "step1-timeout" || run.status === "step2-timeout") && <p>判定できない画面のため自動再実行はしていません。Remote Assistで画面確認できます。</p>}
        </div>}
      </section>
    </div>
  );
}
