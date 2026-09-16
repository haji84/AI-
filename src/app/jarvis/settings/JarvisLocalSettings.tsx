"use client";

import { useEffect, useState } from "react";

const PREFERENCE_KEY = "jarvis-ui-preferences-v1";

type Preferences = {
  density: "comfortable" | "compact";
  motion: "full" | "reduced";
};

const DEFAULTS: Preferences = { density: "comfortable", motion: "full" };

function normalize(value: unknown): Preferences {
  if (!value || typeof value !== "object") return DEFAULTS;
  const candidate = value as Partial<Preferences>;
  return {
    density: candidate.density === "compact" ? "compact" : "comfortable",
    motion: candidate.motion === "reduced" ? "reduced" : "full",
  };
}

function apply(preferences: Preferences) {
  document.documentElement.dataset.jarvisDensity = preferences.density;
  document.documentElement.dataset.jarvisMotion = preferences.motion;
}

export default function JarvisLocalSettings() {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFERENCE_KEY);
      const next = raw ? normalize(JSON.parse(raw)) : DEFAULTS;
      setPreferences(next);
      apply(next);
    } catch {
      setPreferences(DEFAULTS);
      apply(DEFAULTS);
    } finally {
      setReady(true);
    }
  }, []);

  function save(next: Preferences) {
    setPreferences(next);
    apply(next);
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("jarvis-preferences-changed"));
  }

  function reset() {
    window.localStorage.removeItem(PREFERENCE_KEY);
    save(DEFAULTS);
  }

  return (
    <section className="panel jarvis-settings-card" aria-busy={!ready}>
      <div>
        <p className="eyebrow">LOCAL DISPLAY</p>
        <h2>表示設定</h2>
        <p className="muted">この項目はこのブラウザだけに保存される。端末権限、認証、秘密情報、課金設定には触れない。</p>
      </div>

      <fieldset>
        <legend>表示密度</legend>
        <label><input type="radio" name="density" checked={preferences.density === "comfortable"} onChange={() => save({ ...preferences, density: "comfortable" })} /> 標準</label>
        <label><input type="radio" name="density" checked={preferences.density === "compact"} onChange={() => save({ ...preferences, density: "compact" })} /> コンパクト</label>
      </fieldset>

      <fieldset>
        <legend>動き</legend>
        <label><input type="radio" name="motion" checked={preferences.motion === "full"} onChange={() => save({ ...preferences, motion: "full" })} /> 通常</label>
        <label><input type="radio" name="motion" checked={preferences.motion === "reduced"} onChange={() => save({ ...preferences, motion: "reduced" })} /> アニメーションを抑える</label>
      </fieldset>

      <div className="jarvis-button-row"><button className="button secondary" type="button" onClick={reset}>この端末の表示設定をリセット</button></div>
    </section>
  );
}
