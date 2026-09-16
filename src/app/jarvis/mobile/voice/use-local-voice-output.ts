"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readJarvisPreferences } from "../../ui-preferences";
import {
  DEFAULT_VOICE_OUTPUT_SETTINGS,
  enqueueVoiceOutput,
  getSafeVoiceMessage,
  normalizeVoiceOutputSettings,
  shouldSpeakVoiceOutput,
  voiceStyleForPreference,
  VOICE_OUTPUT_SETTINGS_KEY,
  type QueuedVoiceOutput,
  type SafeVoiceMessageKey,
  type VoiceOutputPriority,
  type VoiceOutputSettings,
} from "./voice-output-policy";

function readSettings(): VoiceOutputSettings {
  if (typeof window === "undefined") return { ...DEFAULT_VOICE_OUTPUT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(VOICE_OUTPUT_SETTINGS_KEY);
    return raw ? normalizeVoiceOutputSettings(JSON.parse(raw)) : { ...DEFAULT_VOICE_OUTPUT_SETTINGS };
  } catch {
    return { ...DEFAULT_VOICE_OUTPUT_SETTINGS };
  }
}

function persistSettings(settings: VoiceOutputSettings) {
  try {
    window.localStorage.setItem(VOICE_OUTPUT_SETTINGS_KEY, JSON.stringify(normalizeVoiceOutputSettings(settings)));
  } catch {
    // Restricted/private browser storage must not break command input or Human Gate behavior.
  }
}

export function useLocalVoiceOutput() {
  const [settings, setSettings] = useState<VoiceOutputSettings>(() => ({ ...DEFAULT_VOICE_OUTPUT_SETTINGS }));
  const [voicePreference, setVoicePreference] = useState("neutral");
  const [persona, setPersona] = useState("standard");
  const [supported, setSupported] = useState(false);
  const queueRef = useRef<QueuedVoiceOutput[]>([]);
  const speakingRef = useRef(false);
  const counterRef = useRef(0);
  const settingsRef = useRef(settings);
  const voicePreferenceRef = useRef(voicePreference);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { voicePreferenceRef.current = voicePreference; }, [voicePreference]);

  const interrupt = useCallback(() => {
    queueRef.current = [];
    speakingRef.current = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const drain = useCallback(() => {
    if (speakingRef.current || typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return;

    let next = queueRef.current.shift();
    while (next && !shouldSpeakVoiceOutput(settingsRef.current, voicePreferenceRef.current, next.priority, new Date())) {
      next = queueRef.current.shift();
    }
    if (!next) return;

    const utterance = new SpeechSynthesisUtterance(getSafeVoiceMessage(next.message));
    const style = voiceStyleForPreference(voicePreferenceRef.current);
    utterance.lang = "ja-JP";
    utterance.rate = style.rate;
    utterance.pitch = style.pitch;
    utterance.volume = style.volume;
    speakingRef.current = true;

    const complete = () => {
      speakingRef.current = false;
      window.setTimeout(() => drain(), 0);
    };
    utterance.onend = complete;
    utterance.onerror = complete;
    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback((message: SafeVoiceMessageKey, priority: VoiceOutputPriority = "normal") => {
    if (typeof window === "undefined") return;
    counterRef.current += 1;
    const item: QueuedVoiceOutput = {
      id: `${Date.now()}-${counterRef.current}`,
      message,
      priority,
      createdAt: new Date().toISOString(),
    };
    queueRef.current = enqueueVoiceOutput(queueRef.current, item);
    if (priority === "critical" && speakingRef.current && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      speakingRef.current = false;
    }
    drain();
  }, [drain]);

  const updateSettings = useCallback((patch: Partial<VoiceOutputSettings>) => {
    setSettings((current) => {
      const next = normalizeVoiceOutputSettings({ ...current, ...patch });
      persistSettings(next);
      settingsRef.current = next;
      if (next.muted) interrupt();
      return next;
    });
  }, [interrupt]);

  useEffect(() => {
    const syncPreferences = () => {
      const preferences = readJarvisPreferences();
      setVoicePreference(preferences.voice);
      setPersona(preferences.persona);
      voicePreferenceRef.current = preferences.voice;
      if (preferences.voice === "silent") interrupt();
    };
    setSettings(readSettings());
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined");
    syncPreferences();
    window.addEventListener("jarvis-preferences-changed", syncPreferences);
    return () => {
      window.removeEventListener("jarvis-preferences-changed", syncPreferences);
      interrupt();
    };
  }, [interrupt]);

  return { settings, voicePreference, persona, supported, speak, interrupt, updateSettings };
}
