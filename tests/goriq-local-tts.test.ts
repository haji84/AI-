import assert from "node:assert/strict";
import test from "node:test";
import { discoverLocalTts, normalizeLocalTtsBase, synthesizeLocalTts } from "../src/jarvis/local-tts.ts";

test("local TTS endpoints are loopback-only", () => {
  assert.equal(normalizeLocalTtsBase("http://127.0.0.1:10101"), "http://127.0.0.1:10101");
  assert.equal(normalizeLocalTtsBase("http://localhost:50021/"), "http://localhost:50021");
  assert.throws(() => normalizeLocalTtsBase("https://example.com"));
  assert.throws(() => normalizeLocalTtsBase("http://192.168.1.5:10101"));
});

test("AivisSpeech is preferred and catalog is bounded to twelve voices with terms evidence", async () => {
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    const isAivis = url.port === "10101";
    if (url.pathname === "/speakers") {
      const styles = Array.from({ length: isAivis ? 8 : 8 }, (_, index) => ({ id: (isAivis ? 100 : 200) + index, name: `Style ${index + 1}` }));
      return Response.json([{ name: isAivis ? "Aivis" : "Voicevox", speaker_uuid: isAivis ? "aivis-uuid" : "voicevox-uuid", styles }]);
    }
    if (url.pathname === "/speaker_info") return Response.json({ policy: "Usage terms are available." });
    return new Response("not found", { status: 404 });
  };

  const status = await discoverLocalTts(fakeFetch);
  assert.equal(status.available, true);
  assert.equal(status.primary, "aivis");
  assert.equal(status.voices.length, 12);
  assert.ok(status.voices.slice(0, 8).every((voice) => voice.engine === "aivis"));
  assert.ok(status.voices.every((voice) => voice.termsAvailable));
  assert.equal(status.localOnly, true);
  assert.equal(status.paidFallback, false);
});

test("VOICEVOX becomes fallback when AivisSpeech is unavailable", async () => {
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(String(input));
    if (url.port === "10101") return new Response("offline", { status: 503 });
    if (url.pathname === "/speakers") return Response.json([{ name: "VV", speaker_uuid: "vv", styles: [{ id: 3, name: "Normal" }] }]);
    if (url.pathname === "/speaker_info") return Response.json({ policy: "Voice terms" });
    return new Response("not found", { status: 404 });
  };
  const status = await discoverLocalTts(fakeFetch);
  assert.equal(status.primary, "voicevox");
  assert.equal(status.voices[0]?.id, "voicevox:3");
});

test("synthesis uses the discovered local voice and returns bounded wav bytes", async () => {
  const synthesizedQueries: Array<Record<string, unknown>> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.port === "50021") return new Response("offline", { status: 503 });
    if (url.pathname === "/speakers") return Response.json([{ name: "Aivis", speaker_uuid: "a", styles: [{ id: 7, name: "Calm" }] }]);
    if (url.pathname === "/speaker_info") return Response.json({ policy: "terms" });
    if (url.pathname === "/audio_query") return Response.json({ speedScale: 1, pitchScale: 0, volumeScale: 1, accent_phrases: [] });
    if (url.pathname === "/synthesis") {
      synthesizedQueries.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(new Uint8Array([82, 73, 70, 70, 1, 2, 3]), { headers: { "Content-Type": "audio/wav" } });
    }
    return new Response("not found", { status: 404 });
  };

  const result = await synthesizeLocalTts({ text: "テスト", voiceId: "aivis:7", rate: 1.2, pitch: 0.05, volume: 0.8 }, fakeFetch);
  assert.equal(result.engine, "aivis");
  assert.equal(result.voice.id, "aivis:7");
  assert.ok(result.contentBase64.length > 0);
  const synthesizedQuery = synthesizedQueries[0] ?? {};
  assert.equal(synthesizedQuery.speedScale, 1.2);
  assert.equal(synthesizedQuery.pitchScale, 0.05);
  assert.equal(synthesizedQuery.volumeScale, 0.8);
});
