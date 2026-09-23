"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  activePersonalUiProfile, createPersonalUiHistory, defaultPersonalUiState, pushPersonalUiHistory,
  readPersonalUiState, redoPersonalUiHistory, undoPersonalUiHistory, writePersonalUiState,
  type PersonalUiState, type PersonalUiProfile,
} from "./personalization-store";
import { applyVisualConcept } from "./visual-concepts";

const LEGACY_KEY = "jarvis-personal-ui-legacy";
type PersonalUiContext = {
  state: PersonalUiState; profile: PersonalUiProfile; ready: boolean; error: string | null;
  legacy: boolean; setLegacy: (value: boolean) => void;
  change: (next: PersonalUiState | ((current: PersonalUiState) => PersonalUiState)) => boolean;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  report: (message: string | null) => void;
};
const Context = createContext<PersonalUiContext | null>(null);

export function usePersonalUi() {
  const value = useContext(Context);
  if (!value) throw new Error("PersonalizationProvider is required");
  return value;
}

export default function PersonalizationProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState(() => createPersonalUiHistory(defaultPersonalUiState()));
  const historyRef = useRef(history);
  const [ready, setReady] = useState(false);
  const [error, report] = useState<string | null>(null);
  const [legacy, legacyState] = useState(false);
  useEffect(() => {
    const load = () => {
      const result = readPersonalUiState();
      const next = createPersonalUiHistory(result.state);
      historyRef.current = next;
      setHistory(next);
      report(result.error);
      try { legacyState(window.localStorage.getItem(LEGACY_KEY) === "true"); }
      catch { report("表示設定を読み込めません。ブラウザーの保存領域を確認してください。"); }
      setReady(true);
    };
    load();
    const sync = (event: StorageEvent) => {
      if (event.key === "jarvis-personal-ui-v1" || event.key === LEGACY_KEY || event.key === null) load();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const state = history.present;
  const profile = activePersonalUiProfile(state);
  useEffect(() => {
    if (ready) applyVisualConcept(legacy ? null : profile.conceptId);
    return () => { applyVisualConcept(null); };
  }, [ready, legacy, profile.conceptId]);

  function persist(next: typeof history) {
    if (!ready) return false;
    const result = writePersonalUiState(next.present);
    report(result.error);
    if (!result.ok) return false;
    historyRef.current = next;
    setHistory(next);
    return true;
  }
  function change(next: PersonalUiState | ((current: PersonalUiState) => PersonalUiState)) {
    const current = historyRef.current;
    return persist(pushPersonalUiHistory(current, typeof next === "function" ? next(current.present) : next));
  }
  function setLegacy(value: boolean) {
    try {
      window.localStorage.setItem(LEGACY_KEY, String(value));
      legacyState(value);
      // Keep a separate preference-save failure visible until that save succeeds.
    } catch { report("表示設定を保存できませんでした。"); }
  }
  return <Context.Provider value={{ state, profile, ready, error, legacy, setLegacy, change,
    undo: () => persist(undoPersonalUiHistory(historyRef.current)),
    redo: () => persist(redoPersonalUiHistory(historyRef.current)),
    canUndo: history.past.length > 0, canRedo: history.future.length > 0, report }}>
    {children}
  </Context.Provider>;
}
