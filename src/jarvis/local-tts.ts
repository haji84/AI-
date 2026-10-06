export type LocalTtsEngineId = "aivis" | "voicevox";

export type LocalTtsVoice = {
  id: string;
  engine: LocalTtsEngineId;
  engineLabel: string;
  speakerUuid: string;
  speakerName: string;
  styleId: number;
  styleName: string;
  label: string;
  termsAvailable: boolean;
};

export type LocalTtsEngineStatus = {
  id: LocalTtsEngineId;
  label: string;
  available: boolean;
  endpoint: string;
  reason?: string;
  voiceCount: number;
};

export type LocalTtsStatus = {
  available: boolean;
  primary: LocalTtsEngineId | null;
  engines: LocalTtsEngineStatus[];
  voices: LocalTtsVoice[];
  maxSelectableVoices: number;
  paidFallback: false;
  localOnly: true;
};

type SpeakerStyle = { id?: unknown; name?: unknown };
type Speaker = { name?: unknown; speaker_uuid?: unknown; styles?: unknown };

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MAX_VOICES = 12;
const MAX_TEXT = 600;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

const ENGINE_CONFIG: ReadonlyArray<{ id: LocalTtsEngineId; label: string; fallback: string; env: string }> = [
  { id: "aivis", label: "AivisSpeech Engine", fallback: "http://127.0.0.1:10101", env: "GORIQ_AIVIS_SPEECH_URL" },
  { id: "voicevox", label: "VOICEVOX Engine", fallback: "http://127.0.0.1:50021", env: "GORIQ_VOICEVOX_URL" },
];

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function normalizeLocalTtsBase(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error("local TTS endpoint must be loopback HTTP without credentials");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function engineBase(config: (typeof ENGINE_CONFIG)[number]): string {
  const configured = process.env[config.env]?.trim();
  return normalizeLocalTtsBase(configured || config.fallback);
}

async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init?: RequestInit, timeoutMs = 1600): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

async function termsAvailable(fetchImpl: FetchLike, base: string, speakerUuid: string): Promise<boolean> {
  try {
    const url = new URL("/speaker_info", `${base}/`);
    url.searchParams.set("speaker_uuid", speakerUuid);
    url.searchParams.set("resource_format", "url");
    const response = await fetchWithTimeout(fetchImpl, url.toString(), undefined, 1200);
    if (!response.ok) return false;
    const body = await response.json() as { policy?: unknown };
    return typeof body.policy === "string" && body.policy.trim().length > 0;
  } catch {
    return false;
  }
}

async function probeEngine(
  config: (typeof ENGINE_CONFIG)[number],
  fetchImpl: FetchLike,
): Promise<{ status: LocalTtsEngineStatus; voices: LocalTtsVoice[] }> {
  let base = config.fallback;
  try {
    base = engineBase(config);
    const response = await fetchWithTimeout(fetchImpl, `${base}/speakers`);
    if (!response.ok) {
      return { status: { id: config.id, label: config.label, available: false, endpoint: base, reason: `HTTP ${response.status}`, voiceCount: 0 }, voices: [] };
    }
    const speakers = await response.json() as unknown;
    if (!Array.isArray(speakers)) throw new Error("invalid speakers response");

    const candidates: Array<Omit<LocalTtsVoice, "termsAvailable">> = [];
    for (const raw of speakers as Speaker[]) {
      const speakerName = typeof raw.name === "string" ? raw.name.trim() : "";
      const speakerUuid = typeof raw.speaker_uuid === "string" ? raw.speaker_uuid.trim() : "";
      const styles = Array.isArray(raw.styles) ? raw.styles as SpeakerStyle[] : [];
      if (!speakerName || !speakerUuid) continue;
      for (const style of styles) {
        const styleId = typeof style.id === "number" && Number.isInteger(style.id) ? style.id : null;
        const styleName = typeof style.name === "string" ? style.name.trim() : "";
        if (styleId === null || !styleName) continue;
        candidates.push({
          id: `${config.id}:${styleId}`,
          engine: config.id,
          engineLabel: config.label,
          speakerUuid,
          speakerName,
          styleId,
          styleName,
          label: `${speakerName} / ${styleName}`,
        });
        if (candidates.length >= MAX_VOICES) break;
      }
      if (candidates.length >= MAX_VOICES) break;
    }

    const policy = new Map<string, boolean>();
    for (const speakerUuid of [...new Set(candidates.map((voice) => voice.speakerUuid))]) {
      policy.set(speakerUuid, await termsAvailable(fetchImpl, base, speakerUuid));
    }
    const voices = candidates.map((voice) => ({ ...voice, termsAvailable: policy.get(voice.speakerUuid) === true }));
    return {
      status: { id: config.id, label: config.label, available: true, endpoint: base, voiceCount: voices.length },
      voices,
    };
  } catch (error) {
    return {
      status: {
        id: config.id,
        label: config.label,
        available: false,
        endpoint: base,
        reason: error instanceof Error ? error.message.slice(0, 160) : "unavailable",
        voiceCount: 0,
      },
      voices: [],
    };
  }
}

export async function discoverLocalTts(fetchImpl: FetchLike = fetch): Promise<LocalTtsStatus> {
  const engines: LocalTtsEngineStatus[] = [];
  const voices: LocalTtsVoice[] = [];
  for (const config of ENGINE_CONFIG) {
    const result = await probeEngine(config, fetchImpl);
    engines.push(result.status);
    for (const voice of result.voices) {
      if (voices.length >= MAX_VOICES) break;
      voices.push(voice);
    }
  }
  const primary = engines.find((engine) => engine.id === "aivis" && engine.available)?.id
    ?? engines.find((engine) => engine.id === "voicevox" && engine.available)?.id
    ?? null;
  return { available: Boolean(primary), primary, engines, voices, maxSelectableVoices: MAX_VOICES, paidFallback: false, localOnly: true };
}

export async function synthesizeLocalTts(
  input: { text: string; voiceId?: string; rate?: number; pitch?: number; volume?: number },
  fetchImpl: FetchLike = fetch,
): Promise<{ contentBase64: string; contentType: "audio/wav"; engine: LocalTtsEngineId; voice: LocalTtsVoice }> {
  const text = input.text.trim();
  if (!text || text.length > MAX_TEXT) throw new Error(`speech text must be 1..${MAX_TEXT} characters`);
  const status = await discoverLocalTts(fetchImpl);
  if (!status.available || !status.voices.length) throw new Error("local TTS engine is unavailable");

  const requested = input.voiceId ? status.voices.find((voice) => voice.id === input.voiceId) : undefined;
  const preferred = status.voices.find((voice) => voice.engine === "aivis" && voice.termsAvailable)
    ?? status.voices.find((voice) => voice.engine === "voicevox" && voice.termsAvailable);
  const voice = requested ?? preferred;
  if (!voice) throw new Error("no voice with available usage terms was detected");
  if (!voice.termsAvailable) throw new Error("selected voice usage terms are unavailable");

  const config = ENGINE_CONFIG.find((candidate) => candidate.id === voice.engine);
  if (!config) throw new Error("unknown local TTS engine");
  const base = engineBase(config);
  const queryUrl = new URL("/audio_query", `${base}/`);
  queryUrl.searchParams.set("text", text);
  queryUrl.searchParams.set("speaker", String(voice.styleId));
  const queryResponse = await fetchWithTimeout(fetchImpl, queryUrl.toString(), { method: "POST" }, 8_000);
  if (!queryResponse.ok) throw new Error(`audio_query failed (HTTP ${queryResponse.status})`);
  const query = await queryResponse.json() as Record<string, unknown>;
  if ("speedScale" in query) query.speedScale = boundedNumber(input.rate, 1, 0.5, 2);
  if ("pitchScale" in query) query.pitchScale = boundedNumber(input.pitch, 0, -0.15, 0.15);
  if ("volumeScale" in query) query.volumeScale = boundedNumber(input.volume, 1, 0, 2);

  const synthesisUrl = new URL("/synthesis", `${base}/`);
  synthesisUrl.searchParams.set("speaker", String(voice.styleId));
  const synthesisResponse = await fetchWithTimeout(fetchImpl, synthesisUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  }, 20_000);
  if (!synthesisResponse.ok) throw new Error(`synthesis failed (HTTP ${synthesisResponse.status})`);
  const bytes = Buffer.from(await synthesisResponse.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error("synthesized audio is empty or too large");
  return { contentBase64: bytes.toString("base64"), contentType: "audio/wav", engine: voice.engine, voice };
}
