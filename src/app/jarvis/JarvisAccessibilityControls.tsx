"use client";

import { useEffect, useState } from "react";
import {
  applyJarvisAccessibilityPreferences,
  DEFAULT_JARVIS_ACCESSIBILITY_PREFERENCES,
  readJarvisAccessibilityPreferences,
  writeJarvisAccessibilityPreferences,
  type JarvisAccessibilityPreferences,
} from "./accessibility-preferences";

export default function JarvisAccessibilityControls() {
  const [preferences, setPreferences] = useState<JarvisAccessibilityPreferences>(DEFAULT_JARVIS_ACCESSIBILITY_PREFERENCES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = readJarvisAccessibilityPreferences();
    setPreferences(next);
    applyJarvisAccessibilityPreferences(next);
    setReady(true);
  }, []);

  function save(patch: Partial<JarvisAccessibilityPreferences>) {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    applyJarvisAccessibilityPreferences(next);
    writeJarvisAccessibilityPreferences(next);
    window.dispatchEvent(new Event("jarvis-accessibility-preferences-changed"));
  }

  function reset() {
    const next = { ...DEFAULT_JARVIS_ACCESSIBILITY_PREFERENCES };
    setPreferences(next);
    applyJarvisAccessibilityPreferences(next);
    writeJarvisAccessibilityPreferences(next);
    window.dispatchEvent(new Event("jarvis-accessibility-preferences-changed"));
  }

  return (
    <section className="panel jarvis-settings-card" aria-busy={!ready}>
      <div>
        <p className="eyebrow">ACCESSIBILITY</p>
        <h2>アクセシビリティ</h2>
        <p className="muted">読みやすさと文字情報の表示だけをこのブラウザに保存する。端末権限、認証、Human Gateは変更しない。</p>
      </div>

      <fieldset>
        <legend>文字サイズ</legend>
        <label><input type="radio" name="jarvis-text-scale" checked={preferences.textScale === "standard"} onChange={() => save({ textScale: "standard" })} /> 標準</label>
        <label><input type="radio" name="jarvis-text-scale" checked={preferences.textScale === "large"} onChange={() => save({ textScale: "large" })} /> 大きく表示</label>
      </fieldset>

      <fieldset>
        <legend>コントラスト</legend>
        <label><input type="radio" name="jarvis-contrast" checked={preferences.contrast === "standard"} onChange={() => save({ contrast: "standard" })} /> 標準</label>
        <label><input type="radio" name="jarvis-contrast" checked={preferences.contrast === "high"} onChange={() => save({ contrast: "high" })} /> 高コントラスト</label>
      </fieldset>

      <fieldset>
        <legend>字幕・文字情報</legend>
        <label><input type="radio" name="jarvis-captions" checked={preferences.captions === "off"} onChange={() => save({ captions: "off" })} /> 標準</label>
        <label><input type="radio" name="jarvis-captions" checked={preferences.captions === "on"} onChange={() => save({ captions: "on" })} /> 字幕表示を優先</label>
        <small className="jarvis-setting-help">JARVIS UIの字幕・文字情報表示を優先する設定。P6の音声認識やリアルタイム音声字幕の完成を意味しない。</small>
      </fieldset>

      <p className="jarvis-accessibility-summary" aria-live="polite">
        文字 {preferences.textScale === "large" ? "大" : "標準"} / コントラスト {preferences.contrast === "high" ? "高" : "標準"} / 字幕 {preferences.captions === "on" ? "ON" : "OFF"}
      </p>
      <div className="jarvis-button-row"><button className="button secondary" type="button" onClick={reset}>アクセシビリティ設定をリセット</button></div>
    </section>
  );
}
