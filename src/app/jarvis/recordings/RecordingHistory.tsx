"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RecordingStatus = "recording" | "stopping" | "completed" | "stopped" | "failed";
type Recording = {
  id: string;
  sessionId: string;
  serial: string;
  status: RecordingStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  intervalMs: number;
  maxFrames: number;
  frameCount: number;
  totalBytes: number;
  stopReason?: string;
  partial: boolean;
  replayable: boolean;
  stale: boolean;
};
type Frame = { recordingId: string; frameNumber: number; mimeType: "image/png"; imageBase64: string };

function fmt(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function statusLabel(recording: Recording) {
  if (recording.stale) return "STALE ACTIVE";
  if (recording.partial) return "FAILED / PARTIAL";
  return recording.status.toUpperCase();
}

export default function RecordingHistory() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [frameNumber, setFrameNumber] = useState(1);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(() => recordings.find((item) => item.id === selectedId) ?? null, [recordings, selectedId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/jarvis/recordings?limit=10", { cache: "no-store" });
      const body = await response.json() as { recordings?: Recording[]; message?: string };
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      const next = body.recordings ?? [];
      setRecordings(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next.find((item) => item.replayable)?.id ?? next[0]?.id ?? "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "記録履歴を取得できません");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFrame = useCallback(async (recordingId: string, nextFrame: number, silent = false) => {
    if (!silent) setBusy(true);
    try {
      const response = await fetch("/api/jarvis/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "frame", recordingId, frameNumber: nextFrame }),
      });
      const body = await response.json() as { frame?: Frame; message?: string };
      if (!response.ok || !body.frame) throw new Error(body.message || `HTTP ${response.status}`);
      setFrame(body.frame);
      setFrameNumber(nextFrame);
      setError("");
      return true;
    } catch (cause) {
      setPlaying(false);
      setError(cause instanceof Error ? cause.message : "フレームを取得できません");
      return false;
    } finally {
      if (!silent) setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    setPlaying(false);
    setFrame(null);
    setFrameNumber(1);
    if (selected?.replayable) void loadFrame(selected.id, 1, true);
  }, [selectedId, selected?.replayable, loadFrame, selected?.id]);

  useEffect(() => {
    if (!playing || !selected?.replayable || selected.frameCount <= 1) return;
    const timer = window.setInterval(() => {
      setFrameNumber((current) => {
        const next = current >= selected.frameCount ? 1 : current + 1;
        void loadFrame(selected.id, next, true);
        return next;
      });
    }, Math.max(250, selected.intervalMs));
    return () => window.clearInterval(timer);
  }, [playing, selected, loadFrame]);

  async function download(action: "download-frame" | "export") {
    if (!selected?.replayable) return;
    setBusy(true);
    try {
      const response = await fetch("/api/jarvis/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, recordingId: selected.id, ...(action === "download-frame" ? { frameNumber } : {}) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: `HTTP ${response.status}` })) as { message?: string };
        throw new Error(body.message || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = action === "download-frame"
        ? `jarvis-recording-${selected.id}-frame-${String(frameNumber).padStart(4, "0")}.png`
        : `jarvis-recording-${selected.id}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "記録を書き出せません");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="jarvis-console">
      <div className="jarvis-toolbar">
        <div>
          <p className="eyebrow">REMOTE ASSIST HISTORY</p>
          <h1>遠隔記録</h1>
          <p className="muted">ローカル保存のPNGフレーム記録を、オーナー認証されたGORIQ経由だけで再生・ダウンロードします。</p>
        </div>
        <div className="jarvis-toolbar-actions">
          <button className="button secondary" disabled={busy || loading} onClick={() => void refresh()}>更新</button>
          <a className="button secondary" href="/jarvis">Fleet Consoleへ戻る</a>
        </div>
      </div>

      {loading && <div className="jarvis-alert"><strong>LOADING</strong><span>記録履歴を読み込んでいます。</span></div>}
      {error && <div className="jarvis-alert"><strong>記録履歴</strong><span>{error}</span></div>}

      <section className="jarvis-grid">
        <article className="panel">
          <div className="section-heading"><div><p className="section-kicker">RECENT 10</p><h2>保存済み記録</h2></div></div>
          {!loading && recordings.length === 0 ? <p className="muted">保存済み記録はありません。</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {recordings.map((item) => (
                <button
                  key={item.id}
                  className="button secondary"
                  style={{ textAlign: "left", justifyContent: "space-between" }}
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={item.id === selectedId}
                >
                  <span>{item.serial} / {statusLabel(item)}</span>
                  <small>{item.frameCount}枚 / {Math.ceil(item.totalBytes / 1024)}KiB / {fmt(item.updatedAt)}</small>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="section-heading"><div><p className="section-kicker">PLAYBACK</p><h2>PNGフレーム再生</h2></div></div>
          {!selected ? <p className="muted">記録を選択してください。</p> : <>
            <p><strong>{selected.serial}</strong> / {statusLabel(selected)} / {selected.frameCount}枚</p>
            {selected.stale && <p className="muted">更新が止まったACTIVE記録です。再読み込み後もSTALEなら、記録プロセスまたは端末状態を確認してください。</p>}
            {selected.stopReason && <p className="muted">終了理由: {selected.stopReason}{selected.partial ? "。失敗前までのフレームを保持しています。" : ""}</p>}
            {frame ? <div className="jarvis-remote-screen">
              <img src={`data:${frame.mimeType};base64,${frame.imageBase64}`} alt={`${selected.serial} 記録フレーム ${frame.frameNumber}`} style={{ maxWidth: "100%", height: "auto" }} />
              <small>Frame {frame.frameNumber}/{selected.frameCount}</small>
            </div> : <div className="jarvis-remote-placeholder">{selected.replayable ? "フレームを読み込み中" : "この記録はまだ再生できません"}</div>}
            <div className="jarvis-button-row" style={{ marginTop: 10 }}>
              <button className="button secondary" disabled={busy || !selected.replayable || frameNumber <= 1} onClick={() => void loadFrame(selected.id, frameNumber - 1)}>前へ</button>
              <button className="button secondary" disabled={!selected.replayable || selected.frameCount <= 1} onClick={() => setPlaying((current) => !current)}>{playing ? "停止" : "再生"}</button>
              <button className="button secondary" disabled={busy || !selected.replayable || frameNumber >= selected.frameCount} onClick={() => void loadFrame(selected.id, frameNumber + 1)}>次へ</button>
              <button className="button secondary" disabled={busy || !selected.replayable} onClick={() => void download("download-frame")}>現在のPNGを保存</button>
              <button className="button secondary" disabled={busy || !selected.replayable} onClick={() => void download("export")}>全フレームJSONを書き出し</button>
            </div>
          </>}
        </article>
      </section>

      <section className="panel jarvis-section">
        <p className="muted">記録は公開URLへ出しません。履歴一覧、PNG取得、書き出しはすべてオーナー認証API経由です。FAILED / PARTIAL は完成扱いにせず、残ったフレームだけを明示して再生します。</p>
      </section>
    </div>
  );
}
