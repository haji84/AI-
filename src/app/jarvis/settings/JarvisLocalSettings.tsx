"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyJarvisPreferences,
  DEFAULT_JARVIS_PREFERENCES,
  JARVIS_ACCENTS,
  JARVIS_LAYOUTS,
  JARVIS_PERSONAS,
  JARVIS_THEMES,
  JARVIS_VOICES,
  readJarvisPreferences,
  writeJarvisPreferences,
  type JarvisPreferences,
} from "../ui-preferences";

export default function JarvisLocalSettings() {
  const [preferences, setPreferences] = useState<JarvisPreferences>(DEFAULT_JARVIS_PREFERENCES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = readJarvisPreferences();
    setPreferences(next);
    applyJarvisPreferences(next);
    setReady(true);
  }, []);

  const personaDescription = useMemo(
    () => JARVIS_PERSONAS.find(([id]) => id === preferences.persona)?.[2] ?? "",
    [preferences.persona],
  );

  function save(patch: Partial<JarvisPreferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    applyJarvisPreferences(next);
    writeJarvisPreferences(next);
    window.dispatchEvent(new Event("jarvis-preferences-changed"));
  }

  function reset() {
    const next = { ...DEFAULT_JARVIS_PREFERENCES };
    setPreferences(next);
    applyJarvisPreferences(next);
    writeJarvisPreferences(next);
    window.dispatchEvent(new Event("jarvis-preferences-changed"));
  }

  return (
    <section className="panel jarvis-settings-card" aria-busy={!ready}>
      <div>
        <p className="eyebrow">LOCAL CUSTOMIZATION</p>
        <h2>表示・ペルソナ設定</h2>
        <p className="muted">テーマ / ペルソナ / 音声設定 / 色 / レイアウトを別々に保存する。この画面はブラウザ内のUI設定だけを変更し、端末権限、認証、秘密情報、課金設定には触れない。</p>
      </div>

      <div className="jarvis-preference-grid">
        <label>
          <span>テーマ <small>{JARVIS_THEMES.length}種類</small></span>
          <select value={preferences.theme} onChange={(event) => save({ theme: event.target.value })}>
            {JARVIS_THEMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>ペルソナ <small>{JARVIS_PERSONAS.length}種類</small></span>
          <select value={preferences.persona} onChange={(event) => save({ persona: event.target.value })}>
            {JARVIS_PERSONAS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <small className="jarvis-setting-help">{personaDescription}</small>
        </label>
        <label>
          <span>音声設定</span>
          <select value={preferences.voice} onChange={(event) => save({ voice: event.target.value })}>
            {JARVIS_VOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <small className="jarvis-setting-help">P6の音声runtimeがこの設定を利用するためのPreference。ここでは音声機能の完成を主張しない。</small>
        </label>
        <label>
          <span>アクセントカラー</span>
          <select value={preferences.accent} onChange={(event) => save({ accent: event.target.value })}>
            {JARVIS_ACCENTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>レイアウト</span>
          <select value={preferences.layout} onChange={(event) => save({ layout: event.target.value })}>
            {JARVIS_LAYOUTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      </div>

      <fieldset>
        <legend>表示密度</legend>
        <label><input type="radio" name="density" checked={preferences.density === "comfortable"} onChange={() => save({ density: "comfortable" })} /> 標準</label>
        <label><input type="radio" name="density" checked={preferences.density === "compact"} onChange={() => save({ density: "compact" })} /> コンパクト</label>
      </fieldset>

      <fieldset>
        <legend>動き</legend>
        <label><input type="radio" name="motion" checked={preferences.motion === "full"} onChange={() => save({ motion: "full" })} /> 通常</label>
        <label><input type="radio" name="motion" checked={preferences.motion === "reduced"} onChange={() => save({ motion: "reduced" })} /> アニメーションを抑える</label>
      </fieldset>

      <div className="jarvis-preference-summary" aria-live="polite">
        <span>テーマ: <strong>{preferences.theme}</strong></span>
        <span>ペルソナ: <strong>{preferences.persona}</strong></span>
        <span>音声: <strong>{preferences.voice}</strong></span>
        <span>色: <strong>{preferences.accent}</strong></span>
        <span>レイアウト: <strong>{preferences.layout}</strong></span>
      </div>

      <div className="jarvis-button-row"><button className="button secondary" type="button" onClick={reset}>この端末の表示設定をリセット</button></div>
    </section>
  );
}
