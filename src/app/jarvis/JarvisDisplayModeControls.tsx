"use client";

import { useEffect, useState } from "react";
import { applyJarvisDistanceMeters, readJarvisDistanceMeters, writeJarvisDistanceMeters, type JarvisDistanceMeters } from "./distance-mode";
import {
  applyJarvisDisplayMode,
  JARVIS_DISPLAY_MODES,
  readJarvisDisplayMode,
  writeJarvisDisplayMode,
  type JarvisDisplayMode,
} from "./display-modes";

export default function JarvisDisplayModeControls() {
  const [mode, setMode] = useState<JarvisDisplayMode>("standard");
  const [distance, setDistance] = useState<JarvisDistanceMeters>(3);

  useEffect(() => {
    const initial = readJarvisDisplayMode();
    setMode(initial);
    applyJarvisDisplayMode(initial);
    const initialDistance = readJarvisDistanceMeters();
    setDistance(initialDistance);
    applyJarvisDistanceMeters(initialDistance);
  }, []);

  function select(next: JarvisDisplayMode) {
    setMode(next);
    writeJarvisDisplayMode(next);
    applyJarvisDisplayMode(next);
  }

  const description = JARVIS_DISPLAY_MODES.find(([id]) => id === mode)?.[2] ?? "";

  return (
    <section className="jarvis-display-modes" aria-label="表示モード">
      <div className="jarvis-display-mode-buttons" role="group" aria-label="JARVIS表示モード">
        {JARVIS_DISPLAY_MODES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="jarvis-display-mode-button"
            aria-pressed={mode === id}
            onClick={() => select(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "distance" && <label className="jarvis-distance-control">想定距離
        <select value={distance} onChange={(event) => { const next = Number(event.target.value) as JarvisDistanceMeters; setDistance(next); writeJarvisDistanceMeters(next); }}>
          <option value={3}>約3m</option><option value={4}>約4m</option><option value={5}>約5m</option>
        </select>
      </label>}
      <p className="jarvis-display-mode-status" aria-live="polite">
        表示モード: <strong>{JARVIS_DISPLAY_MODES.find(([id]) => id === mode)?.[1]}</strong>
        <span>{description}</span>
      </p>
    </section>
  );
}
