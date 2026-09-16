"use client";

import { useEffect, useState } from "react";
import {
  applyJarvisOperationMode,
  JARVIS_OPERATION_MODES,
  readJarvisOperationMode,
  type JarvisOperationMode,
  writeJarvisOperationMode,
} from "./operation-mode";

export default function JarvisOperationModeControls() {
  const [mode, setMode] = useState<JarvisOperationMode>("standard");

  useEffect(() => {
    const stored = readJarvisOperationMode();
    setMode(stored);
    applyJarvisOperationMode(stored);
  }, []);

  function choose(next: JarvisOperationMode) {
    writeJarvisOperationMode(next);
    applyJarvisOperationMode(next);
    setMode(next);
    window.dispatchEvent(new CustomEvent("jarvis-operation-mode-changed", { detail: next }));
  }

  const current = JARVIS_OPERATION_MODES.find(([id]) => id === mode) ?? JARVIS_OPERATION_MODES[0];
  return (
    <section className="jarvis-operation-modes" aria-label="JARVIS 操作モード">
      <div className="jarvis-operation-mode-buttons">
        {JARVIS_OPERATION_MODES.map(([id, label, description]) => (
          <button
            key={id}
            type="button"
            className="jarvis-display-mode-button"
            aria-pressed={mode === id}
            title={description}
            onClick={() => choose(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="jarvis-display-mode-status" aria-live="polite">
        <strong>操作:</strong><span>{current[1]} / {current[2]}</span>
      </p>
    </section>
  );
}
