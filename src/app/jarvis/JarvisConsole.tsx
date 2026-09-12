"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type NodeItem = {
  id: string;
  label: string;
  kind: string;
  status: string;
  enrollment: string;
  group?: string;
  capabilities: string[];
  telemetry?: { batteryPercent?: number; charging?: boolean; network?: string };
  lastSeenAt: string;
};

type TaskItem = {
  id: string;
  type: string;
  status: string;
  targetNodeId?: string;
  assignedNodeId?: string;
  attempts: number;
  maxAttempts: number;
  updatedAt: string;
  payload?: Record<string, unknown>;
};

type TakeoverItem = { id: string; nodeId: string; taskId?: string; reason: string; status: string; currentUrl?: string };
type StatePayload = {
  generatedAt: string;
  fleet: NodeItem[];
  tasks: TaskItem[];
  activeTakeovers: TakeoverItem[];
  stats: { registered: number; ready: number; offline: number; needsHuman: number; queued: number; running: number; completed: number; failed: number };
  message?: string;
};

type EnrollmentResult = { deepLink?: string; token?: { token: string; mode: string; expiresAt: string; maxDevices: number } };
type RemoteDevice = { serial: string; state: string };
type ScreenshotResult = { serial: string; mimeType: string; imageBase64: string; capturedAt: string };

function fmt(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

export default function JarvisConsole() {
  const [state, setState] = useState<StatePayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<EnrollmentResult | null>(null);
  const [url, setUrl] = useState("");
  const [targetNodeId, setTargetNodeId] = useState("");
  const [remoteDevices, setRemoteDevices] = useState<RemoteDevice[]>([]);
  const [remoteSerial, setRemoteSerial] = useState("");
  const [remoteError, setRemoteError] = useState("");
  const [screenshot, setScreenshot] = useState<ScreenshotResult | null>(null);
  const [remoteText, setRemoteText] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jarvis/state", { cache: "no-store" });
      const body = await response.json() as StatePayload;
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setState(body);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "JARVIS状態を取得できません");
    }
  }, []);

  const refreshRemote = useCallback(async () => {
    try {
      const response = await fetch("/api/jarvis/remote", { cache: "no-store" });
      const body = await response.json() as { devices?: RemoteDevice[]; message?: string };
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      const devices = body.devices ?? [];
      setRemoteDevices(devices);
      setRemoteSerial((current) => current && devices.some((item) => item.serial === current) ? current : devices[0]?.serial ?? "");
      setRemoteError("");
    } catch (cause) {
      setRemoteDevices([]);
      setRemoteError(cause instanceof Error ? cause.message : "Remote Gatewayに接続できません");
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshRemote();
    const timer = window.setInterval(() => {
      void refresh();
      void refreshRemote();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshRemote]);

  async function action(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : `HTTP ${response.status}`);
      setError("");
      await refresh();
      return body;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作に失敗しました");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function remoteAction(payload: Record<string, unknown>) {
    if (!remoteSerial) return null;
    setBusy(true);
    try {
      const response = await fetch("/api/jarvis/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: remoteSerial, ...payload }),
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : `HTTP ${response.status}`);
      setRemoteError("");
      return body;
    } catch (cause) {
      setRemoteError(cause instanceof Error ? cause.message : "遠隔操作に失敗しました");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function captureScreen() {
    const body = await remoteAction({ action: "screenshot" });
    if (body?.imageBase64 && typeof body.imageBase64 === "string") setScreenshot(body as unknown as ScreenshotResult);
  }

  async function createEnrollment(mode: "quick" | "full" | "fleet") {
    const body = await action({ action: "enrollment", mode, maxDevices: mode === "fleet" ? 100 : 1, group: mode === "fleet" ? "android-fleet" : undefined });
    if (body) setEnrollment(body as EnrollmentResult);
  }

  const recentTasks = useMemo(() => state?.tasks.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20) ?? [], [state]);

  return (
    <div className="jarvis-console">
      <div className="jarvis-toolbar">
        <div>
          <p className="eyebrow">JARVIS DEVICE OS</p>
          <h1>JARVIS Fleet Console</h1>
          <p className="muted">最大100ノード。登録、稼働、Queue、遠隔確認、Human Takeoverをここで管理する。</p>
        </div>
        <div className="jarvis-toolbar-actions"><button className="button secondary" disabled={busy} onClick={() => { void refresh(); void refreshRemote(); }}>更新</button><a className="button secondary" href="/">AI会社へ戻る</a></div>
      </div>

      {error && <div className="jarvis-alert"><strong>接続状態</strong><span>{error}</span></div>}

      <section className="jarvis-stats">
        <article><span>登録</span><strong>{state?.stats.registered ?? 0}<small>/100</small></strong></article>
        <article><span>READY</span><strong>{state?.stats.ready ?? 0}</strong></article>
        <article><span>実行中</span><strong>{state?.stats.running ?? 0}</strong></article>
        <article><span>Queue</span><strong>{state?.stats.queued ?? 0}</strong></article>
        <article><span>要操作</span><strong className={(state?.stats.needsHuman ?? 0) > 0 ? "text-alert" : ""}>{state?.stats.needsHuman ?? 0}</strong></article>
        <article><span>Offline</span><strong>{state?.stats.offline ?? 0}</strong></article>
      </section>

      <section className="jarvis-grid">
        <article className="panel">
          <div className="section-heading"><div><p className="section-kicker">ENROLLMENT</p><h2>端末を追加</h2></div></div>
          <div className="jarvis-button-row">
            <button className="button secondary" disabled={busy} onClick={() => void createEnrollment("quick")}>既存Android</button>
            <button className="button secondary" disabled={busy} onClick={() => void createEnrollment("full")}>新品・初期化Android</button>
            <button className="button secondary" disabled={busy} onClick={() => void createEnrollment("fleet")}>100台Fleet</button>
          </div>
          {enrollment?.token && <div className="jarvis-enrollment-result">
            <strong>{enrollment.token.mode.toUpperCase()} 登録トークン</strong>
            <code>{enrollment.token.token}</code>
            <small>期限 {fmt(enrollment.token.expiresAt)} / 最大 {enrollment.token.maxDevices} 台</small>
            {enrollment.deepLink && <a className="button secondary" href={enrollment.deepLink}>このAndroidをJARVISに登録</a>}
            <p>Androidで登録リンクを開けばワンタップ登録できます。</p>
          </div>}
        </article>

        <article className="panel">
          <div className="section-heading"><div><p className="section-kicker">TASK</p><h2>URLジョブ</h2></div></div>
          <form className="jarvis-task-form" onSubmit={async (event) => {
            event.preventDefault();
            const result = await action({ action: "open-url", url, targetNodeId: targetNodeId || undefined });
            if (result) setUrl("");
          }}>
            <input required type="url" pattern="https://.*" placeholder="https://..." value={url} onChange={(event) => setUrl(event.target.value)} />
            <select value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)}>
              <option value="">自動で端末を選ぶ</option>
              {(state?.fleet ?? []).map((node) => <option key={node.id} value={node.id}>{node.label} ({node.status})</option>)}
            </select>
            <button className="button secondary" disabled={busy}>Queueへ追加</button>
          </form>
        </article>
      </section>

      <section className="panel jarvis-section jarvis-remote-panel">
        <div className="section-heading"><div><p className="section-kicker">REMOTE ASSIST</p><h2>遠隔画面・手動操作</h2></div><span className="operation-badge">スマホ / PC</span></div>
        <p className="muted">対象Androidは拠点PCの許可リストに入っている端末だけ操作できます。ADB自体をインターネットへ公開しません。</p>
        {remoteError && <div className="jarvis-alert"><strong>Remote Gateway</strong><span>{remoteError}</span></div>}
        <div className="jarvis-remote-layout">
          <div className="jarvis-remote-screen">
            {screenshot ? <button type="button" className="jarvis-screen-button" title="画面をタップ" onClick={(event) => {
              const image = event.currentTarget.querySelector("img");
              if (!image) return;
              const rect = image.getBoundingClientRect();
              const naturalWidth = image.naturalWidth || rect.width;
              const naturalHeight = image.naturalHeight || rect.height;
              const x = Math.round((event.clientX - rect.left) * naturalWidth / rect.width);
              const y = Math.round((event.clientY - rect.top) * naturalHeight / rect.height);
              void remoteAction({ action: "tap", x, y }).then(() => captureScreen());
            }}><img src={`data:${screenshot.mimeType};base64,${screenshot.imageBase64}`} alt={`${screenshot.serial} の現在画面`} /></button> : <div className="jarvis-remote-placeholder">端末を選んで「画面を見る」</div>}
            {screenshot && <small>取得 {fmt(screenshot.capturedAt)} / 画像上をタップすると実機をタップ</small>}
          </div>
          <div className="jarvis-remote-controls">
            <select value={remoteSerial} onChange={(event) => { setRemoteSerial(event.target.value); setScreenshot(null); }}>
              <option value="">遠隔端末を選択</option>
              {remoteDevices.map((device) => <option value={device.serial} key={device.serial}>{device.serial} ({device.state})</option>)}
            </select>
            <button className="button secondary" disabled={busy || !remoteSerial} onClick={() => void captureScreen()}>画面を見る</button>
            <div className="jarvis-button-row">
              <button className="button secondary" disabled={busy || !remoteSerial} onClick={() => void remoteAction({ action: "keyevent", key: "BACK" }).then(() => captureScreen())}>戻る</button>
              <button className="button secondary" disabled={busy || !remoteSerial} onClick={() => void remoteAction({ action: "keyevent", key: "HOME" }).then(() => captureScreen())}>ホーム</button>
              <button className="button secondary" disabled={busy || !remoteSerial} onClick={() => void remoteAction({ action: "keyevent", key: "APP_SWITCH" }).then(() => captureScreen())}>履歴</button>
            </div>
            <div className="jarvis-button-row">
              <button className="button secondary" disabled={busy || !remoteSerial} onClick={() => void remoteAction({ action: "swipe", x1: 500, y1: 1400, x2: 500, y2: 500, durationMs: 300 }).then(() => captureScreen())}>↑ スワイプ</button>
              <button className="button secondary" disabled={busy || !remoteSerial} onClick={() => void remoteAction({ action: "swipe", x1: 500, y1: 500, x2: 500, y2: 1400, durationMs: 300 }).then(() => captureScreen())}>↓ スワイプ</button>
            </div>
            <form className="jarvis-task-form" onSubmit={async (event) => { event.preventDefault(); if (await remoteAction({ action: "text", text: remoteText })) { setRemoteText(""); await captureScreen(); } }}>
              <input maxLength={256} placeholder="端末へ文字入力" value={remoteText} onChange={(event) => setRemoteText(event.target.value)} />
              <button className="button secondary" disabled={busy || !remoteSerial || !remoteText}>入力</button>
            </form>
            <form className="jarvis-task-form" onSubmit={async (event) => { event.preventDefault(); if (await remoteAction({ action: "open-url", url: remoteUrl })) { setRemoteUrl(""); await captureScreen(); } }}>
              <input type="url" pattern="https://.*" placeholder="https://... をこの端末で開く" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} />
              <button className="button secondary" disabled={busy || !remoteSerial || !remoteUrl}>開く</button>
            </form>
          </div>
        </div>
      </section>

      <section className="panel jarvis-section">
        <div className="section-heading"><div><p className="section-kicker">FLEET</p><h2>端末一覧</h2></div><span className="count-badge neutral">{state?.fleet.length ?? 0}</span></div>
        <div className="jarvis-table-wrap"><table className="jarvis-table"><thead><tr><th>端末</th><th>状態</th><th>登録</th><th>通信</th><th>電池</th><th>最終接続</th></tr></thead><tbody>
          {(state?.fleet ?? []).map((node) => <tr key={node.id}><td><strong>{node.label}</strong><small>{node.id}</small></td><td><span className={`jarvis-node-status ${node.status}`}>{node.status}</span></td><td>{node.enrollment}</td><td>{node.telemetry?.network ?? "-"}</td><td>{node.telemetry?.batteryPercent ?? "-"}%{node.telemetry?.charging ? " ⚡" : ""}</td><td>{fmt(node.lastSeenAt)}</td></tr>)}
          {(state?.fleet.length ?? 0) === 0 && <tr><td colSpan={6} className="jarvis-empty">まだ端末は登録されていません。</td></tr>}
        </tbody></table></div>
      </section>

      {state?.activeTakeovers.length ? <section className="panel jarvis-section jarvis-takeover">
        <div className="section-heading"><div><p className="section-kicker alert-kicker">HUMAN TAKEOVER</p><h2>人間操作が必要</h2></div><span className="count-badge">{state.activeTakeovers.length}</span></div>
        {state.activeTakeovers.map((item) => <div className="jarvis-takeover-row" key={item.id}><div><strong>{item.nodeId}</strong><p>{item.reason}</p>{item.currentUrl && <small>{item.currentUrl}</small>}</div><button className="button secondary" disabled={busy} onClick={() => void action({ action: "resolve-takeover", sessionId: item.id, resumeTask: true })}>解決済み・自動再開</button></div>)}
      </section> : null}

      <section className="panel jarvis-section">
        <div className="section-heading"><div><p className="section-kicker">QUEUE</p><h2>最近のJARVISタスク</h2></div><span className="count-badge neutral">{state?.tasks.length ?? 0}</span></div>
        <div className="jarvis-table-wrap"><table className="jarvis-table"><thead><tr><th>Task</th><th>種類</th><th>状態</th><th>端末</th><th>試行</th><th>更新</th></tr></thead><tbody>
          {recentTasks.map((task) => <tr key={task.id}><td><small>{task.id}</small></td><td>{task.type}</td><td>{task.status}</td><td>{task.assignedNodeId ?? task.targetNodeId ?? "自動"}</td><td>{task.attempts}/{task.maxAttempts}</td><td>{fmt(task.updatedAt)}</td></tr>)}
          {recentTasks.length === 0 && <tr><td colSpan={6} className="jarvis-empty">JARVISタスクはありません。</td></tr>}
        </tbody></table></div>
      </section>

      <p className="jarvis-updated">最終取得 {fmt(state?.generatedAt)}</p>
    </div>
  );
}
