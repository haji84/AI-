"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  REMOTE_ASSIST_FLEET_WINDOW,
  REMOTE_ASSIST_REFRESH_CONCURRENCY,
  remoteAssistAdaptiveRefreshMs,
  remoteAssistRefreshConcurrency,
  remoteAssistVisibleSerials,
  runRemoteAssistBounded,
  type RemoteAssistViewMode,
} from "../../jarvis/remote-assist-view.ts";

export type RemoteAssistGridDevice = {
  serial: string;
  state: string;
  remoteAssistCapability?: "VIEW_ONLY" | "CONTROLLABLE" | "FULL_MANAGEMENT" | null;
};

type Session = {
  id: string;
  serial: string;
  capability: "VIEW_ONLY" | "CONTROLLABLE" | "FULL_MANAGEMENT";
  status: "active" | "ended" | "expired";
};

type Shot = { serial: string; mimeType: string; imageBase64: string; capturedAt: string };

type Props = {
  devices: RemoteAssistGridDevice[];
  onPromote: (serial: string) => void;
};

async function postRemote(payload: Record<string, unknown>) {
  const response = await fetch("/api/jarvis/remote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : `HTTP ${response.status}`);
  return body;
}

export default function RemoteAssistMultiView({ devices, onPromote }: Props) {
  const [mode, setMode] = useState<RemoteAssistViewMode>("split2");
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [fleetPage, setFleetPage] = useState(0);
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const refreshRunning = useRef(false);
  const sessionsRef = useRef<Record<string, Session>>({});

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const availableSerials = useMemo(
    () => devices.filter((device) => device.remoteAssistCapability).map((device) => device.serial),
    [devices],
  );
  const visibleSerials = useMemo(() => remoteAssistVisibleSerials({
    mode,
    availableSerials,
    selectedSerials,
    fleetPage,
  }), [availableSerials, fleetPage, mode, selectedSerials]);
  const fleetPages = Math.max(1, Math.ceil(availableSerials.length / REMOTE_ASSIST_FLEET_WINDOW));
  const visibleFailureRate = visibleSerials.length ? visibleSerials.filter((serial) => Boolean(errors[serial])).length / visibleSerials.length : 0;
  const refreshIntervalMs = useMemo(() => remoteAssistAdaptiveRefreshMs(mode, visibleSerials.length, visibleFailureRate), [mode, visibleFailureRate, visibleSerials.length]);
  const refreshConcurrency = useMemo(() => remoteAssistRefreshConcurrency(visibleSerials.length), [visibleSerials.length]);

  useEffect(() => {
    if (fleetPage >= fleetPages) setFleetPage(Math.max(0, fleetPages - 1));
  }, [fleetPage, fleetPages]);

  const stopSessions = useCallback(async (snapshot: Record<string, Session>) => {
    const active = Object.values(snapshot).filter((session) => session.status === "active");
    await runRemoteAssistBounded(active, REMOTE_ASSIST_REFRESH_CONCURRENCY, async (session) => {
      try {
        await postRemote({ action: "session-end", sessionId: session.id });
      } catch {
        // Best effort. Server-side TTL still fails closed if the close call is interrupted.
      }
      return session.serial;
    });
  }, []);

  const stop = useCallback(async () => {
    const snapshot = sessionsRef.current;
    setRunning(false);
    setSessions({});
    setShots({});
    setErrors({});
    await stopSessions(snapshot);
  }, [stopSessions]);

  useEffect(() => () => {
    for (const session of Object.values(sessionsRef.current)) {
      if (session.status !== "active") continue;
      void fetch("/api/jarvis/remote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "session-end", sessionId: session.id }),
        keepalive: true,
      });
    }
  }, []);

  const refreshShots = useCallback(async (sessionSnapshot: Record<string, Session>) => {
    if (refreshRunning.current || document.visibilityState !== "visible") return;
    refreshRunning.current = true;
    try {
      const targets = visibleSerials
        .map((serial) => sessionSnapshot[serial])
        .filter((session): session is Session => Boolean(session && session.status === "active"));
      await runRemoteAssistBounded(targets, refreshConcurrency, async (session) => {
        try {
          const body = await postRemote({ action: "screenshot", serial: session.serial, sessionId: session.id });
          if (typeof body.imageBase64 === "string") {
            setShots((current) => ({ ...current, [session.serial]: body as unknown as Shot }));
            setErrors((current) => {
              if (!(session.serial in current)) return current;
              const next = { ...current };
              delete next[session.serial];
              return next;
            });
          }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "画面を取得できません";
          setErrors((current) => ({ ...current, [session.serial]: message }));
          if (/session|active|expired|見つかりません/i.test(message)) {
            setSessions((current) => {
              const next = { ...current };
              delete next[session.serial];
              return next;
            });
          }
        }
        return session.serial;
      });
    } finally {
      refreshRunning.current = false;
    }
  }, [refreshConcurrency, visibleSerials]);

  useEffect(() => {
    if (!running) return;
    void refreshShots(sessions);
    const timer = window.setInterval(() => void refreshShots(sessions), refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [refreshIntervalMs, refreshShots, running, sessions]);

  async function start() {
    if (visibleSerials.length === 0) return;
    setBusy(true);
    setErrors({});
    try {
      await stopSessions(sessionsRef.current);
      const created = await runRemoteAssistBounded(visibleSerials, refreshConcurrency, async (serial) => {
        try {
          const body = await postRemote({ action: "session-start", serial });
          const session = body.session;
          if (!session || typeof session !== "object") throw new Error("Remote Assist sessionを開始できません");
          return session as Session;
        } catch (cause) {
          setErrors((current) => ({
            ...current,
            [serial]: cause instanceof Error ? cause.message : "Remote Assist sessionを開始できません",
          }));
          return null;
        }
      });
      const nextSessions: Record<string, Session> = {};
      for (const session of created) if (session) nextSessions[session.serial] = session;
      setSessions(nextSessions);
      setShots({});
      setRunning(Object.keys(nextSessions).length > 0);
    } finally {
      setBusy(false);
    }
  }

  function setViewMode(next: RemoteAssistViewMode) {
    if (running || busy) return;
    setMode(next);
    setFleetPage(0);
    setSelectedSerials([]);
    setShots({});
    setErrors({});
  }

  function setSlot(index: number, serial: string) {
    if (running || busy) return;
    setSelectedSerials((current) => {
      const next = [...current];
      next[index] = serial;
      return next;
    });
  }

  return (
    <section className="panel jarvis-section jarvis-multiview-panel">
      <div className="section-heading">
        <div><p className="section-kicker">MULTI VIEW</p><h2>2 / 4 / Fleet 画面</h2></div>
        <span className="operation-badge">同時取得 {refreshConcurrency} · 更新 {Math.round(refreshIntervalMs / 100) / 10}s</span>
      </div>
      <p className="muted">複数端末は端末ごとに別Sessionで閲覧します。Fleetは1ページ最大{REMOTE_ASSIST_FLEET_WINDOW}台。表示台数と失敗率から更新間隔・同時取得数を自動調整し、負荷上昇時は安全に間引きます。</p>
      <div className="jarvis-button-row">
        <button className="button secondary" disabled={running || busy} onClick={() => setViewMode("split2")}>2画面</button>
        <button className="button secondary" disabled={running || busy} onClick={() => setViewMode("split4")}>4画面</button>
        <button className="button secondary" disabled={running || busy} onClick={() => setViewMode("fleet")}>Fleet Grid</button>
        <button className="button secondary" disabled={busy || running || visibleSerials.length === 0} onClick={() => void start()}>表示開始</button>
        <button className="button secondary" disabled={busy || !running} onClick={() => void stop()}>表示終了</button>
      </div>

      {mode !== "fleet" && <div className="jarvis-multiview-selectors">
        {visibleSerials.map((serial, index) => <select key={`${mode}-${index}`} value={serial} disabled={running || busy} onChange={(event) => setSlot(index, event.target.value)}>
          {availableSerials.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
        </select>)}
      </div>}

      {mode === "fleet" && <div className="jarvis-multiview-pager">
        <button className="button secondary" disabled={running || busy || fleetPage === 0} onClick={() => setFleetPage((page) => Math.max(0, page - 1))}>前</button>
        <span>{fleetPage + 1} / {fleetPages} ページ</span>
        <button className="button secondary" disabled={running || busy || fleetPage + 1 >= fleetPages} onClick={() => setFleetPage((page) => Math.min(fleetPages - 1, page + 1))}>次</button>
      </div>}

      <div className={`jarvis-multiview-grid mode-${mode}`}>
        {visibleSerials.map((serial) => {
          const device = devices.find((item) => item.serial === serial);
          const shot = shots[serial];
          const session = sessions[serial];
          const tileError = errors[serial];
          return <article className="jarvis-multiview-tile" key={serial}>
            <div className="jarvis-multiview-meta">
              <button className="jarvis-device-link" type="button" onClick={() => onPromote(serial)}>{serial}</button>
              <span className="operation-badge">{device?.remoteAssistCapability ?? "UNAVAILABLE"}</span>
            </div>
            <button className="jarvis-multiview-shot" type="button" disabled={!shot} onClick={() => onPromote(serial)} title="単一端末の操作画面へ選択">
              {shot ? <img src={`data:${shot.mimeType};base64,${shot.imageBase64}`} alt={`${serial} のマルチビュー`} /> : <span>{session ? "画面取得待ち" : running ? "Sessionなし" : "表示開始で取得"}</span>}
            </button>
            <small>{tileError ? `ERROR: ${tileError}` : shot ? `取得 ${new Date(shot.capturedAt).toLocaleTimeString("ja-JP")}` : device?.state ?? "-"}</small>
          </article>;
        })}
        {visibleSerials.length === 0 && <div className="jarvis-remote-placeholder">Remote Assist可能な端末がありません。</div>}
      </div>
    </section>
  );
}
