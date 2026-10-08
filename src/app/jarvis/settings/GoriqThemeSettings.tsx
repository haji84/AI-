"use client";

import { useEffect, useMemo, useState } from "react";
import { JARVIS_THEMES, jarvisTheme, type JarvisThemeId } from "../theme-catalog";

const STORAGE_KEY = "jarvis-ui-theme";
const FAVORITES_KEY = "jarvis-ui-theme-favorites-v1";
const EVENT = "goriq-theme-changed";
const LAYOUT_EVENT = "jarvis-screen-layout-profiles-changed";

function readFavorites(): JarvisThemeId[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((id): id is JarvisThemeId => typeof id === "string" && JARVIS_THEMES.some((theme) => theme.id === id));
  } catch {
    return [];
  }
}

export default function GoriqThemeSettings() {
  const [themeId, setThemeId] = useState<JarvisThemeId>("clean-modern");
  const [favorites, setFavorites] = useState<JarvisThemeId[]>([]);

  useEffect(() => {
    const selected = jarvisTheme(window.localStorage.getItem(STORAGE_KEY)).id;
    setThemeId(selected);
    setFavorites(readFavorites());
    document.documentElement.dataset.goriqScreenDesign = selected;
  }, []);

  const favoriteThemes = useMemo(
    () => favorites.map((id) => jarvisTheme(id)),
    [favorites],
  );

  function select(id: JarvisThemeId) {
    window.localStorage.setItem(STORAGE_KEY, id);
    document.documentElement.dataset.goriqScreenDesign = id;
    setThemeId(id);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { themeId: id } }));
    window.dispatchEvent(new Event(LAYOUT_EVENT));
  }

  function preview(id: JarvisThemeId) {
    document.documentElement.dataset.goriqScreenDesign = id;
  }

  function restorePreview() {
    document.documentElement.dataset.goriqScreenDesign = themeId;
  }

  function toggleFavorite(id: JarvisThemeId) {
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }

  function renderTheme(theme: (typeof JARVIS_THEMES)[number]) {
    const favorite = favorites.includes(theme.id);
    return (
      <div className="jarvis-theme-option" key={theme.id}>
        <button
          className="jarvis-theme-apply"
          type="button"
          aria-pressed={theme.id === themeId}
          onClick={() => select(theme.id)}
          onMouseEnter={() => preview(theme.id)}
          onMouseLeave={restorePreview}
          onFocus={() => preview(theme.id)}
          onBlur={restorePreview}
        >
          <span>{theme.label}</span>
          <small>参考{theme.referenceSet} / {theme.mode} / {theme.density}</small>
        </button>
        <button
          className="jarvis-theme-favorite"
          type="button"
          aria-label={favorite ? `${theme.label}をお気に入りから外す` : `${theme.label}をお気に入りに追加`}
          aria-pressed={favorite}
          onClick={() => toggleFavorite(theme.id)}
        >
          {favorite ? "★" : "☆"}
        </button>
      </div>
    );
  }

  return (
    <section className="panel jarvis-settings-card" id="appearance">
      <div>
        <p className="eyebrow">SCREEN DESIGN</p>
        <h2>画面デザイン</h2>
        <p>写真で決めた35種類を個別プリセットとして保持します。見た目や配置を変えても、AIの権限・Goal・データ・Human Gateは変更しません。</p>
      </div>

      {favoriteThemes.length > 0 && (
        <div>
          <h3 className="jarvis-theme-section-title">お気に入り</h3>
          <div className="jarvis-theme-grid jarvis-theme-grid-favorites">
            {favoriteThemes.map(renderTheme)}
          </div>
        </div>
      )}

      <div>
        <h3 className="jarvis-theme-section-title">すべての画面デザイン <small>{JARVIS_THEMES.length}種類</small></h3>
        <div className="jarvis-theme-grid">
          {JARVIS_THEMES.map(renderTheme)}
        </div>
      </div>
    </section>
  );
}

export const GORIQ_THEME_CHANGED_EVENT = EVENT;
