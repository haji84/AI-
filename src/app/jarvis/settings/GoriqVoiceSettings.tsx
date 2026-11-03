"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_GORIQ_VOICE_OUTPUT,
  playGoriqLocalVoice,
  readGoriqVoiceOutput,
  writeGoriqVoiceOutput,
  type GoriqVoiceOutputSettings,
} from "../voice-output";

type Voice = {
  id: string;
  engine: "aivis" | "voicevox";
  engineLabel: string;
  speakerName: string;
  styleName: string;
  label: string;
  termsAvailable: boolean;
};

type EngineStatus = { id: "aivis" | "voicevox"; label: string; available: boolean; voiceCount: number; reason?: string };
type VoiceStatus = {
  available: boolean;
  primary: "aivis" | "voicevox" | null;
  engines: EngineStatus[];
  voices: Voice[];
  maxSelectableVoices: number;
  paidFallback: false;
  localOnly: true;
  message?: string;
};

export default function GoriqVoiceSettings() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [settings, setSettings] = useState<GoriqVoiceOutputSettings>({ ...DEFAULT_GORIQ_VOICE_OUTPUT });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("AivisSpeech Engineを優先し、利用できない時だけVOICEVOX Engineを候補にします。");

  useEffect(() => {
    setSettings(readGoriqVoiceOutput());
    void refresh();
  }, []);

  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/jarvis/voice", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as VoiceStatus;
      setStatus(body);
      if (!response.ok) setMessage(body.message || "ローカル音声エンジンへ接続できません。文字応答はそのまま利用できます。");
      else if (!body.available) setMessage("AivisSpeech / VOICEVOX を検出できません。勝手に有料APIへ切り替えず、文字応答を継続します。");
      else setMessage(`${body.primary === "aivis" ? "AivisSpeech Engine" : "VOICEVOX Engine"} を利用できます。`);
    } catch (error) {
      setStatus(null);
      setMessage(error instanceof Error ? error.message : "音声エンジン状態を取得できません");
    } finally {
      setBusy(false);
    }
  }

  function save(patch: Partial<GoriqVoiceOutputSettings>) {
    const next = writeGoriqVoiceOutput({ ...settings, ...patch });
    setSettings(next);
  }

  const selectedVoice = useMemo(() => status?.voices.find((voice) => voice.id === settings.voiceId) ?? null, [settings.voiceId, status]);

  function toggleTerms(voice: Voice) {
    const accepted = settings.acceptedTerms.includes(voice.id);
    const next = accepted ? settings.acceptedTerms.filter((id) => id !== voice.id) : [...settings.acceptedTerms, voice.id];
    save({ acceptedTerms: next, voiceId: accepted && settings.voiceId === voice.id ? null : settings.voiceId });
  }

  async function preview(voice: Voice) {
    if (!voice.termsAvailable || !settings.acceptedTerms.includes(voice.id)) {
      setMessage("この声は、エンジン側の利用条件を確認してから試し聞きできます。");
      return;
    }
    setBusy(true);
    save({ voiceId: voice.id });
    const result = await playGoriqLocalVoice("GORIQです。音声の試し聞きです。", { ...settings, voiceId: voice.id });
    setMessage(result.ok ? `${voice.label} を再生しました。` : `再生できません: ${result.reason}`);
    setBusy(false);
  }

  return (
    <section className="panel jarvis-settings-card" id="voice">
      <div>
        <p className="eyebrow">VOICE</p>
        <h2>声</h2>
        <p className="muted">回答する声を選びます。標準はAivisSpeech Engine、予備はVOICEVOX Engineです。有料APIへ自動で切り替えません。</p>
      </div>

      <div className="jarvis-voice-engine-row">
        {(status?.engines ?? []).map((engine) => (
          <div className="jarvis-voice-engine-card" key={engine.id}>
            <strong>{engine.label}</strong>
            <span>{engine.available ? `利用可能・${engine.voiceCount}候補` : "未検出"}</span>
            {engine.reason && <small>{engine.reason}</small>}
          </div>
        ))}
      </div>

      <div className="jarvis-button-row">
        <button className="button secondary" type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "確認中…" : "音声エンジンを再確認"}</button>
      </div>

      <div className="jarvis-voice-grid">
        {(status?.voices ?? []).slice(0, 12).map((voice) => {
          const accepted = settings.acceptedTerms.includes(voice.id);
          const selected = settings.voiceId === voice.id;
          return (
            <article className={selected ? "jarvis-voice-card selected" : "jarvis-voice-card"} key={voice.id}>
              <div><strong>{voice.label}</strong><small>{voice.engineLabel}</small></div>
              <label className="jarvis-voice-terms">
                <input type="checkbox" checked={accepted} disabled={!voice.termsAvailable} onChange={() => toggleTerms(voice)} />
                {voice.termsAvailable ? "この音声モデルの利用条件を確認した" : "利用条件をエンジンから取得できないため選択不可"}
              </label>
              <div className="jarvis-button-row">
                <button className="button secondary" type="button" disabled={busy || !accepted || !voice.termsAvailable} onClick={() => void preview(voice)}>試し聞き</button>
                <button className="button" type="button" disabled={!accepted || !voice.termsAvailable} onClick={() => save({ voiceId: voice.id })}>{selected ? "選択中" : "この声にする"}</button>
              </div>
            </article>
          );
        })}
        {status && !status.voices.length && <div className="empty-state"><strong>声を検出できません</strong><small>AivisSpeech EngineまたはVOICEVOX Engineをローカルで起動すると、ここに候補が表示されます。</small></div>}
      </div>

      <div className="jarvis-preference-grid">
        <label><span>話す速さ <small>{settings.rate.toFixed(2)}x</small></span><input type="range" min="0.5" max="2" step="0.05" value={settings.rate} onChange={(event) => save({ rate: Number(event.target.value) })} /></label>
        <label><span>声の高さ <small>{settings.pitch.toFixed(2)}</small></span><input type="range" min="-0.15" max="0.15" step="0.01" value={settings.pitch} onChange={(event) => save({ pitch: Number(event.target.value) })} /></label>
        <label><span>音量 <small>{settings.volume.toFixed(2)}</small></span><input type="range" min="0" max="2" step="0.05" value={settings.volume} onChange={(event) => save({ volume: Number(event.target.value) })} /></label>
      </div>

      <p className="control-message" role="status">{message}</p>
      {selectedVoice && <p className="jarvis-boundary-note">現在の声: {selectedVoice.label} / {selectedVoice.engineLabel}</p>}
      <p className="jarvis-boundary-note">声・話す速さ・高さ・音量は表示/再生設定です。ペルソナや発話スタイル、Goal、権限、Human Gateとは別に扱います。</p>
    </section>
  );
}
