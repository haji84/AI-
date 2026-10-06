export const GORIQ_VOICE_OUTPUT_KEY = "goriq-voice-output-v1";

export type GoriqVoiceOutputSettings = {
  voiceId: string | null;
  rate: number;
  pitch: number;
  volume: number;
  acceptedTerms: string[];
};

export const DEFAULT_GORIQ_VOICE_OUTPUT: GoriqVoiceOutputSettings = {
  voiceId: null,
  rate: 1,
  pitch: 0,
  volume: 1,
  acceptedTerms: [],
};

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeGoriqVoiceOutput(value: unknown): GoriqVoiceOutputSettings {
  const candidate = value && typeof value === "object" ? value as Partial<GoriqVoiceOutputSettings> : {};
  return {
    voiceId: typeof candidate.voiceId === "string" && candidate.voiceId.trim() ? candidate.voiceId.trim().slice(0, 120) : null,
    rate: clamp(candidate.rate, 1, 0.5, 2),
    pitch: clamp(candidate.pitch, 0, -0.15, 0.15),
    volume: clamp(candidate.volume, 1, 0, 2),
    acceptedTerms: Array.isArray(candidate.acceptedTerms)
      ? candidate.acceptedTerms.filter((item): item is string => typeof item === "string" && item.length <= 120).slice(0, 24)
      : [],
  };
}

export function readGoriqVoiceOutput(): GoriqVoiceOutputSettings {
  if (typeof window === "undefined") return { ...DEFAULT_GORIQ_VOICE_OUTPUT };
  try {
    const raw = window.localStorage.getItem(GORIQ_VOICE_OUTPUT_KEY);
    return raw ? normalizeGoriqVoiceOutput(JSON.parse(raw)) : { ...DEFAULT_GORIQ_VOICE_OUTPUT };
  } catch {
    return { ...DEFAULT_GORIQ_VOICE_OUTPUT };
  }
}

export function writeGoriqVoiceOutput(settings: GoriqVoiceOutputSettings): GoriqVoiceOutputSettings {
  const normalized = normalizeGoriqVoiceOutput(settings);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(GORIQ_VOICE_OUTPUT_KEY, JSON.stringify(normalized)); } catch {}
  }
  return normalized;
}

export async function playGoriqLocalVoice(
  text: string,
  settings = readGoriqVoiceOutput(),
): Promise<{ ok: true; engine: string; voiceId: string } | { ok: false; reason: string }> {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 600);
  if (!clean) return { ok: false, reason: "empty" };
  try {
    const response = await fetch("/api/jarvis/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: clean,
        voiceId: settings.voiceId,
        rate: settings.rate,
        pitch: settings.pitch,
        volume: settings.volume,
      }),
    });
    const body = await response.json().catch(() => ({})) as { contentBase64?: string; contentType?: string; engine?: string; voice?: { id?: string }; message?: string };
    if (!response.ok || !body.contentBase64) return { ok: false, reason: body.message || `HTTP ${response.status}` };
    const binary = window.atob(body.contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: body.contentType || "audio/wav" }));
    const audio = new Audio(url);
    await audio.play();
    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
    audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
    return { ok: true, engine: body.engine || "local", voiceId: body.voice?.id || settings.voiceId || "auto" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "voice playback failed" };
  }
}
