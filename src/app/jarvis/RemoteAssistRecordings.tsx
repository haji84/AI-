"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { RecordingSummary } from "../../jarvis/remote-assist-playback";

const labels: Record<string, string> = { recording: "記録中", stopping: "停止中", completed: "記録終了", stopped: "停止済み", failed: "失敗" };

export default function RemoteAssistRecordings() {
  const [records, setRecords] = useState<RecordingSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [frame, setFrame] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [failedFrame, setFailedFrame] = useState("");
  const [loadedFrame, setLoadedFrame] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const record = records.find(item => item.id === selected);
  const source = record && record.frameCount > 0 ? `/api/jarvis/recordings?id=${encodeURIComponent(record.id)}&frame=${frame}` : "";

  async function refresh() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(""); setWarning(""); setFailedFrame("");
    try {
      const response = await fetch("/api/jarvis/recordings", { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "記録の取得に失敗しました");
      if (!Array.isArray(body.recordings)) throw new Error("記録の応答が不正です");
      setRecords(body.recordings); setSelected(""); setFrame(1); setLoaded(true);
      if (body.unreadable || body.truncated) setWarning("読み取れない記録、または表示上限を超える記録があります。");
    } catch (caught) {
      if (!controller.signal.aborted) { setRecords([]); setSelected(""); setError(caught instanceof Error ? caught.message : "記録の取得に失敗しました"); }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <section aria-label="PNG記録の履歴" className="panel jarvis-section" style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}>
    <h3>PNG記録の履歴</h3>
    <p>画面を一定間隔で保存した記録です。動画ファイルではありません。保存済み記録の閲覧は端末操作を再開しません。</p>
    <button className="button secondary" disabled={busy} onClick={() => void refresh()}>{busy ? "読み込み中…" : "履歴を更新"}</button>
    {error && <p role="alert">{error}</p>}
    {warning && <p role="status">{warning}</p>}
    {loaded && !records.length && !error && <p>保存された記録はありません。</p>}
    {records.length > 0 && <label>記録を選択 <select style={{ width: "100%", minWidth: 0, maxWidth: "100%" }} value={selected} onChange={event => { setSelected(event.target.value); setFrame(1); setFailedFrame(""); }}>
      <option value="">選択してください</option>
      {records.map(item => <option key={item.id} value={item.id}>{item.serial} / {new Date(item.createdAt).toLocaleString("ja-JP")} / {labels[item.status] || item.status} / {item.frameCount}枚</option>)}
    </select></label>}
    {record && <p>{labels[record.status]}・{record.frameCount}枚。記録中の枚数は「履歴を更新」で再取得します。</p>}
    {source && <>
      <div className="jarvis-button-row">
        <button className="button secondary" disabled={frame <= 1} onClick={() => setFrame(value => value - 1)}>前のフレーム</button>
        <span aria-live="polite">{frame} / {record!.frameCount}</span>
        <button className="button secondary" disabled={frame >= record!.frameCount} onClick={() => setFrame(value => value + 1)}>次のフレーム</button>
        <a className="button secondary" href={`${source}&download=1`} download>PNGを保存</a>
      </div>
      {loadedFrame !== source && failedFrame !== source && <p role="status">フレームを読み込み中…</p>}
      {failedFrame === source ? <p role="alert">フレームを開けません。認証状態と履歴を更新してください。</p> : <Image key={source} src={source} alt={`${record!.serial}の保存画面 ${frame}枚目`} width={720} height={1280} unoptimized style={{ width: "100%", maxWidth: 720, height: "auto" }} onLoad={() => setLoadedFrame(source)} onError={() => setFailedFrame(source)} />}
    </>}
  </section>;
}
