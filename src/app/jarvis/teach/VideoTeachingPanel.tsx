"use client";

import { useEffect, useRef, useState } from 'react';
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
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); if (source) URL.revokeObjectURL(source); }, [source]);

  function choose(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('video/') || file.size > VIDEO_MAX_BYTES) { setMessage('512MB以下の動画を選んでください'); return; }
    controller.current?.abort();
    setSource(URL.createObjectURL(file)); setReady(false); setMarkers([]); setMessage('');
  }
  function add() {
    const video = videoRef.current;
    if (!video || !ready || markers.length >= VIDEO_MAX_MARKERS) return;
    setMarkers(previous => [...previous, { id: crypto.randomUUID(), seconds: video.currentTime, instruction: '', confirmed: false }]);
  }
  function edit(id: string, patch: Partial<VideoTeachingMarker>) {
    setMarkers(previous => previous.map(marker => marker.id === id ? { ...marker, ...patch } : marker));
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
    <h2>録画から手順の下書きを作る</h2>
    <p>動画はこのブラウザ内だけで処理し、アップロードしません。画面変化を候補として抽出しますが、タップの意味や入力文字を自動認識する機能ではありません。</p>
    <label>操作の録画（512MB・3時間以内）<input type="file" accept="video/*" disabled={scanning} onChange={event => choose(event.target.files?.[0])}/></label>
    {source && <video ref={videoRef} src={source} controls={!scanning} playsInline preload="metadata" style={{ width: '100%', maxHeight: 480 }} onLoadedMetadata={() => {
      try { videoSampleTimes(videoRef.current?.duration ?? NaN); setReady(true); } catch (error) { setReady(false); setMessage(error instanceof Error ? error.message : '未対応の動画です'); }
    }} onError={() => { setReady(false); controller.current?.abort(); setMessage('このブラウザで再生できない動画です。MP4またはWebMなど別形式を試してください'); }}/>} 
    <div className="jarvis-toolbar-actions">
      <button type="button" className="button secondary" disabled={!ready || scanning || markers.length > 0} onClick={() => void scan()}>画面変化から候補を作る</button>
      <button type="button" className="button secondary" disabled={!ready || scanning || markers.length >= VIDEO_MAX_MARKERS} onClick={add}>今の位置に手順を追加</button>
      {scanning && <button type="button" className="button secondary" onClick={() => controller.current?.abort()}>解析を中止</button>}
    </div>
    {scanning && <p role="status">解析中 {progress}%</p>}
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
    <p>保存前にページを閉じると候補は失われます。保存されるのは確認した説明と時刻だけです。動画由来の下書きは自動実行できません。実機の操作対象・画面条件との対応付けと再現検証が必要です。</p>
  </section>;
}
