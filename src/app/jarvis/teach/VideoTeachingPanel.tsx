"use client";

import { useEffect, useRef, useState } from 'react';
import VideoReplayControls from './VideoReplayControls';
import type { VideoActionPlan } from '../../../jarvis/video-action-plan';
import { frameDifference, videoInstructions, videoSampleTimes, videoTimestamp, VIDEO_MAX_BYTES, VIDEO_MAX_MARKERS, type VideoTeachingMarker } from '../../../jarvis/video-teaching';

function seek(video: HTMLVideoElement, seconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(Error('解析を中止しました')); return; }
    if (Math.abs(video.currentTime - seconds) < 0.02 && video.readyState >= 2) { resolve(); return; }
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', failed); signal.removeEventListener('abort', failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(Error(signal.aborted ? '解析を中止しました' : '動画の読込に失敗しました')); };
    const timer = window.setTimeout(failed, 5000);
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', failed, { once: true });
    video.currentTime = seconds;
  });
}

export default function VideoTeachingPanel({ onApply }: { onApply: (instructions: string) => void }) {
  const [source, setSource] = useState('');
  const [ready, setReady] = useState(false);
  const [markers, setMarkers] = useState<VideoTeachingMarker[]>([]);
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [goal, setGoal] = useState('');
  const [learned, setLearned] = useState<{ id: string; plan: VideoActionPlan } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); if (source) URL.revokeObjectURL(source); }, [source]);

  function choose(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('video/') || file.size > VIDEO_MAX_BYTES) { setMessage('512MB以下の動画を選んでください'); return; }
    controller.current?.abort();
    setSource(URL.createObjectURL(file)); setReady(false); setMarkers([]); setLearned(null); setMessage('');
  }
  function add() {
    const video = videoRef.current;
    if (!video || !ready || markers.length >= VIDEO_MAX_MARKERS) return;
    setMarkers(previous => [...previous, { id: crypto.randomUUID(), seconds: video.currentTime, instruction: '', confirmed: false }]);
  }
  function edit(id: string, patch: Partial<VideoTeachingMarker>) {
    setMarkers(previous => previous.map(marker => marker.id === id ? { ...marker, ...patch } : marker));
  }
  async function understand() {
    const video = videoRef.current; if (!video || !ready || !goal.trim()) return;
    const abort = new AbortController(); controller.current = abort;
    setScanning(true); setLearned(null); setMessage('ZBookのローカルAIで録画を確認しています'); video.pause();
    const original = video.currentTime;
    try {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = Math.max(1, Math.round(640 * video.videoHeight / video.videoWidth));
      if (canvas.height > 2560) throw Error('動画の縦横比が未対応です');
      const context = canvas.getContext('2d'); if (!context) throw Error('動画を読み込めません');
      const frames: string[] = [];
      for (let i = 0; i < 12; i++) { await seek(video, i * Math.max(0, video.duration - 0.05) / 11, abort.signal); context.drawImage(video, 0, 0, canvas.width, canvas.height); frames.push(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]); setProgress(Math.round((i + 1) / 12 * 100)); }
      const r = await fetch('/api/jarvis/teaching/video', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal, body: JSON.stringify({ goal, frames }) });
      const body = await r.json(); if (!r.ok) throw Error(body.message); setLearned(body); setMessage('操作候補を推定しました。実機で照合するまでは未検証です');
    } catch (e) { setMessage(abort.signal.aborted ? '解析を中止しました' : e instanceof Error ? e.message : '動画理解に失敗しました'); }
    finally { if (!abort.signal.aborted) video.currentTime = original; setScanning(false); }
  }
  async function scan() {
    const video = videoRef.current;
    if (!video || !ready) return;
    const abort = new AbortController(); controller.current = abort;
    const originalTime = video.currentTime; video.pause(); setScanning(true); setProgress(0); setMessage('');
    try {
      const times = videoSampleTimes(video.duration);
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw Error('このブラウザでは画面解析が使えません');
      let previous: Uint8ClampedArray | undefined;
      const candidates: VideoTeachingMarker[] = [];
      for (let i = 0; i < times.length; i++) {
        await seek(video, times[i], abort.signal);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const current = context.getImageData(0, 0, canvas.width, canvas.height).data;
        if (!previous || frameDifference(previous, current) >= 0.18) {
          candidates.push({ id: crypto.randomUUID(), seconds: times[i], instruction: '', confirmed: false });
          if (candidates.length >= VIDEO_MAX_MARKERS) break;
        }
        previous = current; setProgress(Math.round((i + 1) / times.length * 100));
      }
      if (abort.signal.aborted) throw Error('解析を中止しました');
      setMarkers(candidates); setMessage(`${candidates.length}件の画面変化候補です。操作内容を確認して入力してください。候補の見落としや誤検出があります。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '解析に失敗しました'); }
    finally {
      if (!abort.signal.aborted) video.currentTime = originalTime;
      setScanning(false);
    }
  }
  return <section className="panel jarvis-section">
    <h2>録画から手順を学ぶ</h2>
    <p>画面変化の抽出はブラウザ内で処理します。「AIで操作を推定」は12枚の画像を自宅ZBookのローカルAIへ送ります。外部AIサービスには送りません。録画の短い操作は見落とす可能性があります。</p>
    <label>操作の録画（512MB・3時間以内）<input type="file" accept="video/*" disabled={scanning || executing} onChange={event => choose(event.target.files?.[0])}/></label>
    {source && <video ref={videoRef} src={source} controls={!scanning} playsInline preload="metadata" style={{ width: '100%', maxHeight: 480 }} onLoadedMetadata={() => {
      try { videoSampleTimes(videoRef.current?.duration ?? NaN); setReady(true); } catch (error) { setReady(false); setMessage(error instanceof Error ? error.message : '未対応の動画です'); }
    }} onError={() => { setReady(false); controller.current?.abort(); setMessage('このブラウザで再生できない動画です。MP4またはWebMなど別形式を試してください'); }}/>} 
    <div className="jarvis-toolbar-actions">
      <button type="button" className="button secondary" disabled={!ready || scanning || markers.length > 0} onClick={() => void scan()}>画面変化から候補を作る</button>
      <button type="button" className="button secondary" disabled={!ready || scanning || markers.length >= VIDEO_MAX_MARKERS} onClick={add}>今の位置に手順を追加</button>
      {scanning && <button type="button" className="button secondary" onClick={() => controller.current?.abort()}>解析を中止</button>}
    </div>
    {scanning && <p role="status">解析中 {progress}%</p>}
    <label>録画で教える作業<input maxLength={160} value={goal} disabled={scanning || executing} onChange={e => { setGoal(e.target.value); setLearned(null); }}/></label>
    <button type="button" className="button" disabled={!ready || scanning || executing || !goal.trim()} onClick={() => void understand()}>GORIQに学習・再現検証を任せる</button>
    <p>接続端末が1台なら、解析後にその端末を操作して検証まで自動で進めます。複数台の場合だけ端末を選択してください。</p>
    <p>現在の自動再現は「次へ・詳細・戻る」など既存の安全なナビゲーション操作です。文字入力・スワイプ・購入などは自動再現せず停止します。</p>
    {learned && <VideoReplayControls key={learned.id} id={learned.id} plan={learned.plan} onBusy={setExecuting}/>}
    <ol>{markers.map(marker => <li key={marker.id}>
      <button type="button" className="button secondary" disabled={scanning} onClick={() => { if (videoRef.current) videoRef.current.currentTime = marker.seconds; }}>{videoTimestamp(marker.seconds)}を見る</button>
      <label>この場面の操作<input value={marker.instruction} maxLength={320} disabled={scanning} onChange={event => edit(marker.id, { instruction: event.target.value, confirmed: false })} placeholder="例：一覧画面の「詳細」をタップ"/></label>
      <label><input type="checkbox" checked={marker.confirmed} disabled={scanning || !marker.instruction.trim()} onChange={event => edit(marker.id, { confirmed: event.target.checked })}/>録画と照合して内容を確認した</label>
      <button type="button" className="button secondary" disabled={scanning} onClick={() => setMarkers(previous => previous.filter(item => item.id !== marker.id))}>候補を外す</button>
    </li>)}</ol>
    <button type="button" className="button" disabled={scanning || !markers.length || markers.some(marker => !marker.confirmed)} onClick={() => {
      try { onApply(videoInstructions(markers)); setMessage('下の操作手順欄に反映しました。端末情報と完了条件を入力して保存してください。'); } catch (error) { setMessage(error instanceof Error ? error.message : '手順を確認してください'); }
    }}>確認した候補を下の手順欄に反映</button>
    <p role="status">{message}</p>
    <p>手動で説明した候補は保存前にページを閉じると失われます。手動の下書きは自動実行できません。AIの推定結果も、実機の操作対象・画面条件との対応付けと別の再現検証を通るまで未検証です。</p>
  </section>;
}
