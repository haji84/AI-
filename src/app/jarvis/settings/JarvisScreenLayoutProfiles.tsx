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

export default function JarvisScreenLayoutProfilesSettings() {
  const [profiles, setProfiles] = useState<JarvisScreenLayoutProfiles>(DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setProfiles(readJarvisScreenLayoutProfiles());
    setReady(true);
  }, []);

  function save(screen: JarvisPrimaryScreenId, profile: JarvisScreenLayoutProfile) {
    const next = { ...profiles, [screen]: profile };
    setProfiles(next);
    writeJarvisScreenLayoutProfiles(next);
    window.dispatchEvent(new Event("jarvis-screen-layout-profiles-changed"));
  }

  function reset() {
    const next = { ...DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES };
    setProfiles(next);
    writeJarvisScreenLayoutProfiles(next);
    window.dispatchEvent(new Event("jarvis-screen-layout-profiles-changed"));
  }

  return (
    <section className="panel jarvis-settings-card" aria-busy={!ready}>
      <div>
        <p className="eyebrow">SCREEN PROFILES</p>
        <h2>画面ごとのレイアウト</h2>
        <p className="muted">5つの主要画面ごとに表示幅を保存する。「共通設定を使う」なら上のレイアウト設定を引き継ぐ。ブラウザ内の表示だけを変え、端末操作・認証・Human Gateには触れない。</p>
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
        <button className="button secondary" type="button" onClick={reset}>画面別レイアウトを共通設定へ戻す</button>
      </div>
    </section>
  );
}
