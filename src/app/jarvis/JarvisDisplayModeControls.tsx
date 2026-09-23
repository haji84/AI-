"use client";

import { useEffect, useState } from "react";
import {
  applyJarvisDisplayMode,
  JARVIS_DISPLAY_MODES,
  readJarvisDisplayMode,
  writeJarvisDisplayMode,
  type JarvisDisplayMode,
} from "./display-modes";

export default function JarvisDisplayModeControls() {
  const [mode, setMode] = useState<JarvisDisplayMode>("standard");

  useEffect(() => {
    const initial = readJarvisDisplayMode();
    setMode(initial);
    applyJarvisDisplayMode(initial);
  }, []);

  function select(next: JarvisDisplayMode) {
    setMode(next);
    writeJarvisDisplayMode(next);
    applyJarvisDisplayMode(next);
  }

  const description = JARVIS_DISPLAY_MODES.find(([id]) => id === mode)?.[2] ?? "";

  return (
    <section className="jarvis-display-modes" aria-label="表示モード">
      <div className="jarvis-display-mode-buttons" role="group" aria-label="GORIQ表示モード">
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
      <p className="jarvis-display-mode-status" aria-live="polite">
        表示モード: <strong>{JARVIS_DISPLAY_MODES.find(([id]) => id === mode)?.[1]}</strong>
        <span>{description}</span>
      </p>
    </section>
  );
}
