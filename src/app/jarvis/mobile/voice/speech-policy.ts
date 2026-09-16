import { readJarvisPreferences } from "../../ui-preferences.ts";

export const JARVIS_SPEECH_POLICY_KEY = "jarvis-speech-policy-v1";
export const MAX_LOCAL_SPEECH_QUEUE = 8;

export type SpeechPriority = "low" | "normal" | "high" | "critical";

export type SpeechPolicySettings = {
  muted: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  quietMinimumPriority: "high" | "critical";
};

export type SpeechQueueEntry = {
  id: string;
  text: string;
  priority: SpeechPriority;
  sequence: number;
};

export const DEFAULT_SPEECH_POLICY: SpeechPolicySettings = {
  muted: true,
  quietHoursEnabled: false,
  quietStart: "22:00",
  quietEnd: "07:00",
  quietMinimumPriority: "critical",
};

const PRIORITY_WEIGHT: Record<SpeechPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

const queue: SpeechQueueEntry[] = [];
let activeSpeech = false;
let sequence = 0;

function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return fallback;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function normalizeSpeechPolicySettings(value: unknown): SpeechPolicySettings {
  const candidate = value && typeof value === "object" ? value as Partial<SpeechPolicySettings> : {};
  return {
    muted: candidate.muted !== false,
    quietHoursEnabled: candidate.quietHoursEnabled === true,
    quietStart: normalizeTime(candidate.quietStart, DEFAULT_SPEECH_POLICY.quietStart),
    quietEnd: normalizeTime(candidate.quietEnd, DEFAULT_SPEECH_POLICY.quietEnd),
    quietMinimumPriority: candidate.quietMinimumPriority === "high" ? "high" : "critical",
  };
}

export function readSpeechPolicySettings(): SpeechPolicySettings {
  if (typeof window === "undefined") return { ...DEFAULT_SPEECH_POLICY };
  try {
    const raw = window.localStorage.getItem(JARVIS_SPEECH_POLICY_KEY);
    return raw ? normalizeSpeechPolicySettings(JSON.parse(raw)) : { ...DEFAULT_SPEECH_POLICY };
  } catch {
    return { ...DEFAULT_SPEECH_POLICY };
  }
}

export function writeSpeechPolicySettings(settings: SpeechPolicySettings): SpeechPolicySettings {
  const normalized = normalizeSpeechPolicySettings(settings);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(JARVIS_SPEECH_POLICY_KEY, JSON.stringify(normalized));
    } catch {
      // Restricted/private browser storage is allowed to fail. The next read returns the conservative muted default.
    }
  }
  return normalized;
}

function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours * 60) + minutes;
}

export function isQuietHoursActive(settings: SpeechPolicySettings, now = new Date()): boolean {
  if (!settings.quietHoursEnabled) return false;
  const start = minutesFromTime(settings.quietStart);
  const end = minutesFromTime(settings.quietEnd);
  const current = (now.getHours() * 60) + now.getMinutes();
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function containsSensitiveSpeechText(text: string): boolean {
  return text.includes("[REDACTED]")
    || /%5bredacted%5d/i.test(text)
    || /\b(?:token|api[_-]?key|password|passwd|secret|authorization)\b\s*[:=]/i.test(text)
    || /\bbearer\s+[a-z0-9._~+\/-]+/i.test(text);
}

export function shouldSpeakLocal(
  text: string,
  priority: SpeechPriority,
  settings: SpeechPolicySettings,
  now = new Date(),
): { allowed: true } | { allowed: false; reason: "muted" | "quiet-hours" | "sensitive" | "empty" } {
  if (!text.trim()) return { allowed: false, reason: "empty" };
  if (containsSensitiveSpeechText(text)) return { allowed: false, reason: "sensitive" };
  if (settings.muted) return { allowed: false, reason: "muted" };
  if (isQuietHoursActive(settings, now) && PRIORITY_WEIGHT[priority] < PRIORITY_WEIGHT[settings.quietMinimumPriority]) {
    return { allowed: false, reason: "quiet-hours" };
  }
  return { allowed: true };
}

export function sortSpeechQueueEntries(entries: SpeechQueueEntry[]): SpeechQueueEntry[] {
  return entries.slice().sort((left, right) => {
    const priorityDifference = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
    return priorityDifference || left.sequence - right.sequence;
  });
}

export function speechProfileForPreference(voicePreference: string): { rate: number; pitch: number; volume: number } {
  switch (voicePreference) {
    case "deep": return { rate: 0.92, pitch: 0.75, volume: 1 };
    case "clear": return { rate: 0.9, pitch: 1.05, volume: 1 };
    case "soft": return { rate: 0.88, pitch: 1, volume: 0.72 };
    case "calm": return { rate: 0.82, pitch: 0.92, volume: 0.9 };
    case "fast": return { rate: 1.18, pitch: 1, volume: 1 };
    case "brief": return { rate: 1.08, pitch: 1, volume: 1 };
    case "silent": return { rate: 1, pitch: 1, volume: 0 };
    default: return { rate: 1, pitch: 1, volume: 1 };
  }
}

function drainLocalSpeechQueue() {
  if (activeSpeech || typeof window === "undefined") return;
  const synthesis = window.speechSynthesis;
  if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") return;
  const entry = queue.shift();
  if (!entry) return;

  const utterance = new SpeechSynthesisUtterance(entry.text);
  const profile = speechProfileForPreference(readJarvisPreferences().voice);
  utterance.lang = "ja-JP";
  utterance.rate = profile.rate;
  utterance.pitch = profile.pitch;
  utterance.volume = profile.volume;
  activeSpeech = true;
  const finish = () => {
    activeSpeech = false;
    drainLocalSpeechQueue();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  synthesis.speak(utterance);
}

export function enqueueLocalSpeech(
  text: string,
  priority: SpeechPriority = "normal",
  settings = readSpeechPolicySettings(),
  now = new Date(),
): { queued: true } | { queued: false; reason: "muted" | "quiet-hours" | "sensitive" | "empty" | "unsupported" } {
  const policy = shouldSpeakLocal(text, priority, settings, now);
  if (!policy.allowed) return { queued: false, reason: policy.reason };
  if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
    return { queued: false, reason: "unsupported" };
  }

  sequence += 1;
  queue.push({ id: `speech-${sequence}`, text: text.trim().slice(0, 240), priority, sequence });
  const ordered = sortSpeechQueueEntries(queue).slice(0, MAX_LOCAL_SPEECH_QUEUE);
  queue.splice(0, queue.length, ...ordered);
  drainLocalSpeechQueue();
  return { queued: true };
}

export function cancelLocalSpeech() {
  queue.splice(0, queue.length);
  activeSpeech = false;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}
