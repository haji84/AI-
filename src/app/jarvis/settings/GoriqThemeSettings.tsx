"use client";

import { useEffect, useState } from "react";
import { JARVIS_THEMES, jarvisTheme, type JarvisThemeId } from "../theme-catalog";

const STORAGE_KEY = "jarvis-ui-theme";
const EVENT = "goriq-theme-changed";

export default function GoriqThemeSettings() {
  const [themeId, setThemeId] = useState<JarvisThemeId>("clean-modern");

  useEffect(() => {
    setThemeId(jarvisTheme(window.localStorage.getItem(STORAGE_KEY)).id);
  }, []);

  function select(id: JarvisThemeId) {
    window.localStorage.setItem(STORAGE_KEY, id);
    setThemeId(id);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { themeId: id } }));
  }

  return (
    <section className="panel jarvis-settings-card" id="appearance">
      <div>
        <p className="eyebrow">APPEARANCE</p>
        <h2>GORIQの外観</h2>
        <p>20種類の既存テーマから選択します。AIの権限・モデル・Human Gateは変更しません。</p>
      </div>
      <div className="jarvis-theme-grid">
        {JARVIS_THEMES.map((theme) => (
          <button
            type="button"
            key={theme.id}
            aria-pressed={theme.id === themeId}
            onClick={() => select(theme.id)}
          >
            <span>{theme.label}</span>
            <small>{theme.mode} / {theme.density}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export const GORIQ_THEME_CHANGED_EVENT = EVENT;
