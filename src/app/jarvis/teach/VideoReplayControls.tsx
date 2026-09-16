"use client";
import { useEffect, useRef, useState } from 'react';
import type { VideoActionPlan } from '../../../jarvis/video-action-plan';
export default function VideoReplayControls({ id, plan, onBusy }: { id: string; plan: VideoActionPlan; onBusy: (busy: boolean) => void }) {
  const [devices, setDevices] = useState<string[]>([]), [serial, setSerial] = useState('');
  const [variant, setVariant] = useState(''), [verified, setVerified] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const session = useRef('');
  const cancelled = useRef(false);
  useEffect(() => { let active = true; void fetch('/api/jarvis/remote', { cache: 'no-store' }).then(async r => {
    const body = await r.json(); if (!r.ok) throw Error(body.message);
    if (active) { const connected: string[] = (body.devices || []).filter((d: { state: string }) => d.state === 'device').map((d: { serial: string }) => d.serial); setDevices(connected); if (connected.length === 1) { setSerial(connected[0]); void run('teach-video', connected[0]); } }
  }).catch(e => { if (active) setMessage(e.message); }); return () => { active = false; }; }, []);
  async function command(payload: object) {
    const r = await fetch('/api/jarvis/remote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const b = await r.json(); if (!r.ok) throw Error(b.message || b.error || '操作失敗'); return b;
  }
  async function run(action: 'teach-video' | 'teach-verify' | 'teach-execute', device = serial) {
    cancelled.current = false; setBusy(true); onBusy(true); setVerified(false); setMessage('JARVISが画面照合・再現・検証を進めています。操作中は端末を触らないでください');
    try {
      const started = await command({ action: 'session-start', serial: device, ttlMs: 10 * 60000 });
      session.current = started.session.id;
      if (cancelled.current) throw Error('停止しました');
      const b = await command({ action, serial: device, sessionId: session.current, planId: id, variantId: variant });
      if (b.variant) setVariant(b.variant.id);
      setVerified(b.run?.status === 'PASSED'); setMessage(b.run?.status === 'PASSED' ? '再現・完了画面の検証に成功し、手順を記憶しました' : `停止：${b.run?.reason || '開始画面と端末の権限を確認してください'}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : '再現失敗'); }
    finally { if (session.current) { await command({ action: 'session-end', sessionId: session.current }).catch(() => {}); session.current = ''; } setBusy(false); onBusy(false); }
  }
  return <section><h3>AIが推定した手順</h3><ol>{plan.steps.map((s, i) => <li key={i}>{s.label}：{s.before} → {s.after}</li>)}</ol><p>完了条件：{plan.completion}</p>
    <label>再現するAndroid<select value={serial} disabled={busy} onChange={e => { setSerial(e.target.value); setVariant(''); setVerified(false); }}><option value="">端末を選択</option>{devices.map(d => <option key={d}>{d}</option>)}</select></label>
    <p>実機が録画の開始画面にあることを確認してください。不一致・エラー・未対応操作で停止します。機種ごとに再現検証が必要です。</p>
    <button type="button" className="button" disabled={busy || !serial} onClick={() => void run('teach-video')}>実機と照合して再現</button>
    <button type="button" className="button secondary" disabled={busy || !variant} onClick={() => void run('teach-verify')}>開始画面から再現検証</button>
    <button type="button" className="button secondary" disabled={busy || !verified} onClick={() => void run('teach-execute')}>記憶した手順を実行</button>
    {busy && <button type="button" className="button secondary" onClick={() => { cancelled.current = true; if (session.current) void command({ action: 'session-end', sessionId: session.current }).then(() => setMessage('停止を要求しました。処理中の入力は取り消せませんが次の入力を止めます')).catch(() => setMessage('停止確認に失敗しました。Devicesでセッションを終了してください')); }}>停止</button>}
    <p role="status">{message}</p></section>;
}
