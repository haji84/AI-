"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES,
  JARVIS_PRIMARY_SCREENS,
  JARVIS_SCREEN_LAYOUT_OPTIONS,
  readJarvisScreenLayoutProfiles,
  writeJarvisScreenLayoutProfiles,
  type JarvisPrimaryScreenId,
  type JarvisScreenLayoutProfile,
  type JarvisScreenLayoutProfiles,
} from "../screen-layout-profiles";
import { jarvisTheme, type JarvisThemeId } from "../theme-catalog";
import { GORIQ_THEME_CHANGED_EVENT } from "./GoriqThemeSettings";

const SCREEN_DESIGN_KEY = "jarvis-ui-theme";

export default function JarvisScreenLayoutProfilesSettings() {
  const [profiles, setProfiles] = useState<JarvisScreenLayoutProfiles>(DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES);
  const [designId, setDesignId] = useState<JarvisThemeId>("clean-modern");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = (nextId?: string) => {
      const selected = jarvisTheme(nextId ?? window.localStorage.getItem(SCREEN_DESIGN_KEY)).id;
      setDesignId(selected);
      setProfiles(readJarvisScreenLayoutProfiles(selected));
      setReady(true);
    };
    load();
    const listener = (event: Event) => load((event as CustomEvent<{ themeId?: string }>).detail?.themeId);
    window.addEventListener(GORIQ_THEME_CHANGED_EVENT, listener);
    return () => window.removeEventListener(GORIQ_THEME_CHANGED_EVENT, listener);
  }, []);

  function save(screen: JarvisPrimaryScreenId, profile: JarvisScreenLayoutProfile) {
    const next = { ...profiles, [screen]: profile };
    setProfiles(next);
    writeJarvisScreenLayoutProfiles(next, designId);
    window.dispatchEvent(new Event("jarvis-screen-layout-profiles-changed"));
  }

  function reset() {
    const next = { ...DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES };
    setProfiles(next);
    writeJarvisScreenLayoutProfiles(next, designId);
    window.dispatchEvent(new Event("jarvis-screen-layout-profiles-changed"));
  }

  return (
    <section className="panel jarvis-settings-card" aria-busy={!ready} id="layout">
      <div>
        <p className="eyebrow">SCREEN PROFILES</p>
        <h2>画面の配置を変更</h2>
        <p className="muted">
          「{jarvisTheme(designId).label}」専用の配置として保存します。別の画面デザインへ切り替えると、そのデザインで前回保存した配置へ戻ります。
          表示だけを変え、端末操作・認証・Goal・Human Gateには触れません。
        </p>
      </div>
      <div className="jarvis-preference-grid">
        {JARVIS_PRIMARY_SCREENS.map(([screen, label]) => (
          <label key={screen}>
            <span>{label}</span>
            <select value={profiles[screen]} onChange={(event) => save(screen, event.target.value as JarvisScreenLayoutProfile)}>
              {JARVIS_SCREEN_LAYOUT_OPTIONS.map(([id, optionLabel]) => <option key={id} value={id}>{optionLabel}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="jarvis-button-row">
        <button className="button secondary" type="button" onClick={reset}>この画面デザインの配置を初期状態へ戻す</button>
      </div>
    </section>
  );
}
