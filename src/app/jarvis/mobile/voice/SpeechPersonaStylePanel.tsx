"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_JARVIS_PREFERENCES,
  JARVIS_PERSONAS,
  JARVIS_VOICES,
  readJarvisPreferences,
  writeJarvisPreferences,
  type JarvisPreferences,
} from "../../ui-preferences.ts";
import {
  DEFAULT_SPEECH_POLICY,
  readSpeechPolicySettings,
  writeSpeechPolicySettings,
  type SpeechPolicySettings,
  type SpeechStyle,
} from "./speech-policy.ts";

const SPEECH_STYLES: readonly [SpeechStyle, string][] = [
  ["standard", "標準"],
  ["brief", "短く"],
  ["formal", "丁寧"],
];

export default function SpeechPersonaStylePanel() {
  const [preferences, setPreferences] = useState<JarvisPreferences>({ ...DEFAULT_JARVIS_PREFERENCES });
  const [speechPolicy, setSpeechPolicy] = useState<SpeechPolicySettings>({ ...DEFAULT_SPEECH_POLICY });
  const [message, setMessage] = useState("音声・ペルソナ・発話スタイルは別々に保存されます。");

  useEffect(() => {
    setPreferences(readJarvisPreferences());
    setSpeechPolicy(readSpeechPolicySettings());
  }, []);

  function updatePreferences(patch: Partial<JarvisPreferences>) {
    const next = { ...preferences, ...patch };
    try {
      writeJarvisPreferences(next);
      const normalized = readJarvisPreferences();
      setPreferences(normalized);
      setMessage("音声設定を保存しました。命令の権限や実行ルールは変わりません。");
    } catch {
      setMessage("このブラウザでは音声設定を保存できませんでした。既定値のまま使えます。");
    }
  }

  function updateStyle(style: SpeechStyle) {
    const next = writeSpeechPolicySettings({ ...speechPolicy, style });
    setSpeechPolicy(next);
    setMessage("発話スタイルを保存しました。固定の状態案内だけに適用します。");
  }

  return (
    <section className="commander-card voice-persona-style-card" aria-label="音声ペルソナと発話スタイル">
      <div className="commander-card-title"><span>話し方</span><small>端末内設定</small></div>
      <div className="voice-persona-style-grid">
        <label>音声プロファイル
          <select value={preferences.voice} onChange={(event) => updatePreferences({ voice: event.target.value })}>
            {JARVIS_VOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>ペルソナ
          <select value={preferences.persona} onChange={(event) => updatePreferences({ persona: event.target.value })}>
            {JARVIS_PERSONAS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>発話スタイル
          <select value={speechPolicy.style} onChange={(event) => updateStyle(event.target.value as SpeechStyle)}>
            {SPEECH_STYLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>
      <p className="commander-hint" aria-live="polite">{message}</p>
      <p className="commander-hint">ペルソナは音声の微調整、発話スタイルは既知の短い状態案内だけに使います。コマンド解析、優先度、端末権限、Human Gateは変更しません。</p>
    </section>
  );
}
