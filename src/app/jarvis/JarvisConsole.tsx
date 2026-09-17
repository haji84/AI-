"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RemoteAssistMultiView from "./RemoteAssistMultiView";
import { startRemoteRefreshLoop } from "../../jarvis/remote-refresh-loop";
import { RemoteCaptureQueue } from "../../jarvis/remote-capture-queue";
import { screenSwipe } from "../../jarvis/remote-screen-input";
import RemoteScreenControl from "./RemoteScreenControl";
import RemoteVideo from "./RemoteVideo";
import TeachingControls from "./TeachingControls";
import { networkLabel } from "./network-label";

type NodeItem = {
  id: string;
  label: string;
  kind: string;
  status: string;
  enrollment: string;
  group?: string;
  capabilities: string[];
  telemetry?: { batteryPercent?: number; charging?: boolean; network?: unknown };
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

type RemoteAssistCapability = "VIEW_ONLY" | "CONTROLLABLE" | "FULL_MANAGEMENT";
type RemoteDevice = { serial: string; state: string; label?: string; reason?: string; remoteAssistCapability?: RemoteAssistCapability | null };
type RemoteAssistSession = {
  id: string;
  serial: string;
  capability: RemoteAssistCapability;
  status: "active" | "ended" | "expired";
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  endedAt?: string;
};
type RemoteAssistRecording = {
  id: string;
  sessionId: string;
  serial: string;
  status: "recording" | "stopping" | "completed" | "stopped" | "failed";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  intervalMs: number;
  maxFrames: number;
  frameCount: number;
  totalBytes: number;
  stopReason?: string;
};
type ScreenshotResult = { serial: string; mimeType: string; imageBase64: string; capturedAt: string; nativeWidth?: number; nativeHeight?: number };
type RemoteRequestOptions = { manual?: boolean; sessionBound?: boolean; silent?: boolean; serial?: string; serialRequired?: boolean };

function fmt(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

export default function JarvisConsole() {
  const [state, setState] = useState<StatePayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [targetNodeId, setTargetNodeId] = useState("");
  const [remoteDevices, setRemoteDevices] = useState<RemoteDevice[]>([]);
  const [remoteSerial, setRemoteSerial] = useState("");
  const [remoteSession, setRemoteSession] = useState<RemoteAssistSession | null>(null);
  const [recording, setRecording] = useState<RemoteAssistRecording | null>(null);
  const [liveRefresh, setLiveRefresh] = useState(false);
  const [videoSession, setVideoSession] = useState("");
  const [remoteError, setRemoteError] = useState("");
  const [screenshot, setScreenshot] = useState<ScreenshotResult | null>(null);
  const remoteInteraction = useRef(false);
  const setRemoteInteraction = useCallback((active: boolean) => { remoteInteraction.current = active; }, []);
  const captureQueue = useRef(new RemoteCaptureQueue());
  const [screenUpdating, setScreenUpdating] = useState(false);
  const captureContext = remoteSession?.status === "active" && remoteSession.serial === remoteSerial ? remoteSession.id + ":" + remoteSerial : "";
  useEffect(() => { remoteInteraction.current = false; captureQueue.current.setContext(captureContext); return () => captureQueue.current.setContext(""); }, [captureContext]);
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
      const body = await response.json() as { devices?: RemoteDevice[]; message?: string; warnings?: string[] };
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      const devices = body.devices ?? [];
      setRemoteDevices(devices);
      setRemoteSerial((current) => {
        const next = current && devices.some((item) => item.serial === current) ? current : devices[0]?.serial ?? "";
        if (current && current !== next) {
          setRemoteSession(null);
          setRecording(null);
          setLiveRefresh(false);
          setScreenshot(null);
        }
        return next;
      });
      setRemoteError(body.warnings?.join(" / ") || "");
    } catch (cause) {
      setRemoteDevices([]);
      setRemoteSession(null);
      setRecording(null);
      setLiveRefresh(false);
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

  const remoteRequest = useCallback(async (
    payload: Record<string, unknown>,
    options: RemoteRequestOptions = {},
  ) => {
    const serial = options.serial ?? remoteSerial;
    if (options.serialRequired !== false && !serial) return null;

    let sessionId: string | undefined;
    const sessionBound = options.manual || options.sessionBound;
    if (sessionBound) {
      if (!remoteSession || remoteSession.status !== "active" || remoteSession.serial !== serial) {
        setRemoteError("この端末のRemote Assist sessionを開始してください");
        setLiveRefresh(false);
        return null;
      }
      sessionId = remoteSession.id;
    }

    if (!options.silent) setBusy(true);
    try {
      const send = () => fetch("/api/jarvis/remote", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(serial ? { serial } : {}),
          ...payload,
          ...(sessionId ? { sessionId } : {}),
        }),
      });
      const response = options.manual && payload.action !== "screenshot"
        ? await captureQueue.current.input(`${sessionId}:${serial}`, send)
        : await send();
      if (!response) return null;
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        if (options.manual && response.status === 409) {
          setRemoteSession(null);
          setRecording(null);
          setLiveRefresh(false);
          setScreenshot(null);
        }
        throw new Error(typeof body.message === "string" ? body.message : `HTTP ${response.status}`);
      }
      setRemoteError("");
      return body;
    } catch (cause) {
      setRemoteError(cause instanceof Error ? cause.message : "遠隔操作に失敗しました");
      return null;
    } finally {
      if (!options.silent) setBusy(false);
    }
  }, [remoteSerial, remoteSession]);

  const captureScreen = useCallback(async (silent = false) => {
    setScreenUpdating(true);
    try {
      return await captureQueue.current.request(captureContext,
        async () => {
          const body = await remoteRequest({ action: "screenshot", preview: true }, { manual: true, silent });
          if (!body?.imageBase64) throw new Error("Screen capture failed");
          return body;
        },
        (body) => {
          if (!remoteInteraction.current && body?.imageBase64 && typeof body.imageBase64 === "string") {
            const next = body as unknown as ScreenshotResult;
            setScreenshot((current) => !current || current.serial !== next.serial || Date.parse(next.capturedAt) >= Date.parse(current.capturedAt) ? next : current);
          }
        });
    } finally { setScreenUpdating(false); }
  }, [remoteRequest, captureContext]);

  const remoteSessionActive = remoteSession?.status === "active" && remoteSession.serial === remoteSerial;
  const recordingActive = recording?.status === "recording" || recording?.status === "stopping";
  const selectedRemoteDevice = useMemo(
    () => remoteDevices.find((device) => device.serial === remoteSerial),
    [remoteDevices, remoteSerial],
  );
  const canViewRemote = remoteSessionActive && Boolean(selectedRemoteDevice?.remoteAssistCapability);
  const canControlRemote = remoteSessionActive && (
    selectedRemoteDevice?.remoteAssistCapability === "CONTROLLABLE" ||
    selectedRemoteDevice?.remoteAssistCapability === "FULL_MANAGEMENT"
  );
  const selectedTakeover = useMemo(
    () => state?.activeTakeovers.find((item) => item.nodeId === remoteSerial),
    [state?.activeTakeovers, remoteSerial],
  );

  useEffect(() => {
    if (!liveRefresh || !canViewRemote) return;
    const loop = startRemoteRefreshLoop({
      capture: () => captureScreen(true),
      visible: () => document.visibilityState === "visible" && !remoteInteraction.current,
    });
    const resume = () => { if (document.visibilityState === "visible") loop.resume(); };
    document.addEventListener("visibilitychange", resume);
    return () => { loop.stop(); document.removeEventListener("visibilitychange", resume); };
  }, [captureScreen, canViewRemote, liveRefresh]);

  useEffect(() => {
    if (!recording || (recording.status !== "recording" && recording.status !== "stopping") || !remoteSessionActive) return;
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const body = await remoteRequest(
          { action: "recording-status", recordingId: recording.id },
          { sessionBound: true, silent: true },
        );
        const next = body?.recording;
        if (next && typeof next === "object") setRecording(next as RemoteAssistRecording);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [recording, remoteRequest, remoteSessionActive]);

  async function startRemoteAssist() {
    if (!remoteSerial || !selectedRemoteDevice?.remoteAssistCapability) return;
    const body = await remoteRequest({ action: "session-start" });
    const session = body?.session;
    if (session && typeof session === "object") {
      setRemoteSession(session as RemoteAssistSession);
      setRecording(null);
      setScreenshot(null);
      setLiveRefresh(true);
    }
  }

  async function endRemoteAssist() {
    const session = remoteSession;
    captureQueue.current.setContext("");
    setRemoteSession(null);
    setRecording(null);
    setLiveRefresh(false);
    setScreenshot(null);
    if (!session) return;
    await remoteRequest(
      { action: "session-end", sessionId: session.id },
      { serial: session.serial, serialRequired: false },
    );
  }

  async function startRecording() {
    const body = await remoteRequest(
      { action: "recording-start", durationMs: 300_000, intervalMs: 2_000 },
      { sessionBound: true },
    );
    const next = body?.recording;
    if (next && typeof next === "object") setRecording(next as RemoteAssistRecording);
  }

  async function stopRecording() {
    if (!recording) return;
    const body = await remoteRequest(
      { action: "recording-stop", recordingId: recording.id },
      { sessionBound: true },
    );
    const next = body?.recording;
    if (next && typeof next === "object") setRecording(next as RemoteAssistRecording);
  }

  function selectRemoteDevice(nextSerial: string) {
    if (remoteSession && remoteSession.serial !== nextSerial) void endRemoteAssist();
    setRemoteSerial(nextSerial);
    setRemoteSession(null);
    setRecording(null);
    setLiveRefresh(false);
    setScreenshot(null);
    setRemoteError("");
  }

  async function swipeRemote(direction: "up" | "down") {
    if (!screenshot || screenshot.serial !== remoteSerial) return;
    const input = screenSwipe(screenshot.nativeWidth ?? 0, screenshot.nativeHeight ?? 0, direction);
    if (input && await remoteRequest(input, { manual: true })) await captureScreen();
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
            <a className="button" href="/jarvis/enroll">Androidを登録（複数台対応）</a>
          </div>
          <p>家のWi-FiでWorkerを開くと、所有者の登録画面に表示されます。登録後は遠隔操作一覧へ自動反映します。</p>
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
        <div className="section-heading">
          <div><p className="section-kicker">REMOTE ASSIST</p><h2>遠隔画面・手動操作</h2></div>
          <span className="operation-badge">{selectedRemoteDevice?.remoteAssistCapability ?? "UNAVAILABLE"}</span>
        </div>
        <p className="muted">登録済み端末は自動で表示されます。Wi-Fi操作は対応Workerと端末の操作権限が必要です。USB / ADB接続も引き続き利用できます。画面自動更新は画像を順番に取得し、動画ストリーミングではありません。</p>
        {remoteError && <div className="jarvis-alert"><strong>Remote Gateway</strong><span>{remoteError}</span></div>}
        {selectedTakeover && <div className="jarvis-alert">
          <strong>Human Takeover: {selectedTakeover.nodeId}</strong>
          <span>{selectedTakeover.reason}</span>
          <button className="button secondary" disabled={busy} onClick={() => void action({ action: "resolve-takeover", sessionId: selectedTakeover.id, resumeTask: true })}>続きやって</button>
        </div>}
        <div className="jarvis-remote-layout">
          <div className="jarvis-remote-screen">
            {videoSession && videoSession === remoteSession?.id && canViewRemote && screenshot ? <RemoteVideo
              serial={remoteSerial} sessionId={videoSession}
              nativeWidth={screenshot.nativeWidth} nativeHeight={screenshot.nativeHeight}
              controllable={Boolean(canControlRemote)}
              onInput={(input) => { void remoteRequest(input, { manual: true }); }}
              onStop={() => { setVideoSession(""); setLiveRefresh(true); }}
            /> : screenshot ? <RemoteScreenControl
              key={JSON.stringify([remoteSession?.id, remoteSerial, canControlRemote, screenshot.capturedAt])}
              src={"data:" + screenshot.mimeType + ";base64," + screenshot.imageBase64}
              serial={screenshot.serial}
              nativeWidth={screenshot.nativeWidth}
              nativeHeight={screenshot.nativeHeight}
              onInteractionChange={setRemoteInteraction}
              enabled={Boolean(canControlRemote) && screenshot.serial === remoteSerial}
              onInput={(input) => { void remoteRequest(input, { manual: true }).then(() => captureScreen()); }}
            /> : <div className="jarvis-remote-placeholder">端末を選び、Remote Assistを開始してください</div>}
            {canViewRemote && screenshot && !remoteSerial.startsWith("worker:") && videoSession !== remoteSession?.id && <button className="button" onClick={() => { setLiveRefresh(false); setVideoSession(remoteSession!.id); }}>低遅延動画を開始（60秒）</button>}
            {videoSession !== remoteSession?.id && <p role="status" aria-live="polite">{screenUpdating ? "画面更新中…" : liveRefresh ? "自動更新 ON（通信速度に応じて更新）" : "自動更新 OFF：表示は前回取得した画像です"}</p>}
            {screenshot && videoSession !== remoteSession?.id && <small>取得 {fmt(screenshot.capturedAt)} / {canControlRemote ? "画像上をタップ・スワイプで操作（5秒以内）" : "VIEW ONLY"}</small>}
          </div>
          <div className="jarvis-remote-controls">
            <select value={remoteSerial} onChange={(event) => selectRemoteDevice(event.target.value)}>
              <option value="">遠隔端末を選択</option>
              <optgroup label="登録済み端末（Wi-Fi）">{remoteDevices.filter(device => device.serial.startsWith("worker:")).map((device) => <option value={device.serial} key={device.serial}>{device.label || device.serial} ({device.remoteAssistCapability ?? device.state})</option>)}</optgroup>
              <optgroup label="USB / ADB接続（同じ端末の別接続を含む）">{remoteDevices.filter(device => !device.serial.startsWith("worker:")).map((device) => <option value={device.serial} key={device.serial}>{device.label || device.serial} ({device.remoteAssistCapability ?? device.state})</option>)}</optgroup>
            </select>
            {selectedRemoteDevice?.reason && <p role="status">{selectedRemoteDevice.reason}</p>}
            <div className="jarvis-button-row">
              <button className="button secondary" disabled={busy || !remoteSerial || !selectedRemoteDevice?.remoteAssistCapability || Boolean(remoteSessionActive)} onClick={() => void startRemoteAssist()}>Remote Assist開始</button>
              <button className="button secondary" disabled={busy || !remoteSessionActive} onClick={() => void endRemoteAssist()}>終了</button>
            </div>
            {remoteSessionActive && <small>Session {remoteSession.id.slice(0, 8)}… / {remoteSession.capability} / idle timeoutは操作時に更新</small>}
            <div className="jarvis-button-row">
              <button className="button secondary" disabled={busy || !canViewRemote} onClick={() => void captureScreen()}>画面を見る</button>
              <button className="button secondary" disabled={!canViewRemote} onClick={() => setLiveRefresh((current) => !current)}>画面自動更新 {liveRefresh ? "ON" : "OFF"}</button>
            </div>
            {remoteSerial.startsWith("worker:") ? <p>Wi-Fi接続では画面確認と手動操作が利用できます。手順記録・動画・連続写真保存は現在USB / ADB接続が必要です。</p> : <TeachingControls serial={remoteSerial} sessionId={canControlRemote ? remoteSession?.id : undefined} />}
            <details open={recordingActive || undefined}><summary>補助機能：画面写真の保存</summary>
            <div className="jarvis-button-row">
              <button className="button secondary" disabled={busy || !canViewRemote || recordingActive || remoteSerial.startsWith("worker:")} onClick={() => void startRecording()}>画面写真を5分保存（手順学習なし）</button>
              <button className="button secondary" disabled={busy || !recordingActive} onClick={() => void stopRecording()}>画面写真の保存を停止</button>
            </div>
            {recording && <small>PNGフレーム記録 {recording.status} / {recording.frameCount}/{recording.maxFrames}枚 / {Math.ceil(recording.totalBytes / 1024)}KiB{recording.stopReason ? ` / ${recording.stopReason}` : ""}。動画ファイルではありません。</small>}
            </details>
            <div className="jarvis-button-row">
              <button className="button secondary" disabled={busy || !canControlRemote} onClick={() => void remoteRequest({ action: "keyevent", key: "BACK" }, { manual: true }).then(() => captureScreen())}>戻る</button>
              <button className="button secondary" disabled={busy || !canControlRemote} onClick={() => void remoteRequest({ action: "keyevent", key: "HOME" }, { manual: true }).then(() => captureScreen())}>ホーム</button>
              <button className="button secondary" disabled={busy || !canControlRemote} onClick={() => void remoteRequest({ action: "keyevent", key: "APP_SWITCH" }, { manual: true }).then(() => captureScreen())}>履歴</button>
            </div>
            <div className="jarvis-button-row">
              <button className="button secondary" disabled={busy || !canControlRemote || !screenshot?.nativeWidth || !screenshot?.nativeHeight} onClick={() => void swipeRemote("up")}>↑ スワイプ</button>
              <button className="button secondary" disabled={busy || !canControlRemote || !screenshot?.nativeWidth || !screenshot?.nativeHeight} onClick={() => void swipeRemote("down")}>↓ スワイプ</button>
            </div>
            <form className="jarvis-task-form" onSubmit={async (event) => { event.preventDefault(); if (await remoteRequest({ action: "text", text: remoteText }, { manual: true })) { setRemoteText(""); await captureScreen(); } }}>
              <input maxLength={256} placeholder="端末へ文字入力" value={remoteText} onChange={(event) => setRemoteText(event.target.value)} />
              <button className="button secondary" disabled={busy || !canControlRemote || !remoteText}>入力</button>
            </form>
            <form className="jarvis-task-form" onSubmit={async (event) => { event.preventDefault(); if (await remoteRequest({ action: "open-url", url: remoteUrl }, { manual: true })) { setRemoteUrl(""); await captureScreen(); } }}>
              <input type="url" pattern="https://.*" placeholder="https://... をこの端末で開く" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} />
              <button className="button secondary" disabled={busy || !canControlRemote || !remoteUrl || remoteSerial.startsWith("worker:")}>開く</button>
            </form>
          </div>
        </div>
      </section>

      <RemoteAssistMultiView devices={remoteDevices} onPromote={selectRemoteDevice} />

      <section className="panel jarvis-section">
        <div className="section-heading"><div><p className="section-kicker">FLEET</p><h2>端末一覧</h2></div><span className="count-badge neutral">{state?.fleet.length ?? 0}</span></div>
        <div className="jarvis-table-wrap"><table className="jarvis-table"><thead><tr><th>端末</th><th>状態</th><th>登録</th><th>通信</th><th>電池</th><th>最終接続</th></tr></thead><tbody>
          {(state?.fleet ?? []).map((node) => <tr key={node.id}><td><strong>{node.label}</strong><small>{node.id}</small></td><td><span className={`jarvis-node-status ${node.status}`}>{node.status}</span></td><td>{node.enrollment}</td><td>{networkLabel(node.telemetry?.network)}</td><td>{node.telemetry?.batteryPercent ?? "-"}%{node.telemetry?.charging ? " ⚡" : ""}</td><td>{fmt(node.lastSeenAt)}</td></tr>)}
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
