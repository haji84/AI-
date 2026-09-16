export type VoiceOutputPriority = "normal" | "attention" | "critical";
export type SafeVoiceMessageKey = "command-sent" | "command-blocked" | "command-failed" | "owner-auth-required";

export type VoiceOutputSettings = {
  muted: boolean;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
};

export type VoiceStyle = {
  rate: number;
  pitch: number;
  volume: number;
};

export type QueuedVoiceOutput = {
  id: string;
  message: SafeVoiceMessageKey;
  priority: VoiceOutputPriority;
  createdAt: string;
};

export const VOICE_OUTPUT_SETTINGS_KEY = "jarvis.mobile.voice-output.v1";
export const MAX_VOICE_OUTPUT_QUEUE = 8;

export const DEFAULT_VOICE_OUTPUT_SETTINGS: VoiceOutputSettings = {
  muted: false,
  quietHoursEnabled: false,
  quietStart: "22:00",
  quietEnd: "07:00",
};

const SAFE_MESSAGES: Record<SafeVoiceMessageKey, string> = {
  "command-sent": "指示を送信しました。",
  "command-blocked": "この指示は音声から実行できません。",
  "command-failed": "指示を送信できませんでした。画面を確認してください。",
  "owner-auth-required": "オーナー認証が必要です。画面を確認してください。",
};

const PRIORITY_WEIGHT: Record<VoiceOutputPriority, number> = {
  normal: 1,
  attention: 2,
  critical: 3,
};

function validTime(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return fallback;
  return value;
}

function minutesSinceMidnight(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function normalizeVoiceOutputSettings(value: unknown): VoiceOutputSettings {
  const candidate = value && typeof value === "object" ? value as Partial<VoiceOutputSettings> : {};
  return {
    muted: candidate.muted === true,
    quietHoursEnabled: candidate.quietHoursEnabled === true,
    quietStart: validTime(candidate.quietStart, DEFAULT_VOICE_OUTPUT_SETTINGS.quietStart),
    quietEnd: validTime(candidate.quietEnd, DEFAULT_VOICE_OUTPUT_SETTINGS.quietEnd),
  };
}

export function isQuietHours(settings: VoiceOutputSettings, now: Date): boolean {
  if (!settings.quietHoursEnabled) return false;
  const start = minutesSinceMidnight(settings.quietStart);
  const end = minutesSinceMidnight(settings.quietEnd);
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function shouldSpeakVoiceOutput(
  settings: VoiceOutputSettings,
  voicePreference: string,
  priority: VoiceOutputPriority,
  now: Date,
): boolean {
  if (settings.muted || voicePreference === "silent") return false;
  if (isQuietHours(settings, now) && priority !== "critical") return false;
  return true;
}

export function getSafeVoiceMessage(key: SafeVoiceMessageKey): string {
  return SAFE_MESSAGES[key];
}

export function voiceStyleForPreference(voicePreference: string): VoiceStyle {
  switch (voicePreference) {
    case "deep": return { rate: 0.92, pitch: 0.78, volume: 1 };
    case "clear": return { rate: 0.96, pitch: 1.04, volume: 1 };
    case "soft": return { rate: 0.9, pitch: 1.08, volume: 0.8 };
    case "calm": return { rate: 0.86, pitch: 0.94, volume: 0.9 };
    case "fast": return { rate: 1.18, pitch: 1, volume: 1 };
    case "brief": return { rate: 1.08, pitch: 1, volume: 1 };
    default: return { rate: 1, pitch: 1, volume: 1 };
  }
}

export function enqueueVoiceOutput(
  queue: readonly QueuedVoiceOutput[],
  item: QueuedVoiceOutput,
): QueuedVoiceOutput[] {
  const withoutDuplicate = queue.filter((entry) => entry.id !== item.id);
  return [...withoutDuplicate, item]
    .sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || a.createdAt.localeCompare(b.createdAt))
    .slice(0, MAX_VOICE_OUTPUT_QUEUE);
}
