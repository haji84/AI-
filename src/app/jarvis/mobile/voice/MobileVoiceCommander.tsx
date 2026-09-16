"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptySharedCommandContext,
  loadSharedCommandContext,
  recordSharedCommand,
  saveSharedTargetNode,
  selectSharedHistoryEntry,
  type SharedCommandContext,
} from "../command-context";
import { getSafeContextCandidates, resolveSafeContextReference } from "../context-reference";
import { parseSafeMobileCommand } from "../voice-command";

type FleetNode = { id: string; label: string; status: string; lastSeenAt: string };
type StatePayload = { fleet?: FleetNode[]; message?: string };

type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative; length: number };
type RecognitionEventLike = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorLike = { error?: string; message?: string };
type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: RecognitionErrorLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => RecognitionLike;
type SpeechWindow = Window & typeof globalThis & {
  SpeechRecognition?: RecognitionCtor;
  webkitSpeechRecognition?: RecognitionCtor;
};

function recognitionConstructor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function shortAge(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`;
  return `${Math.floor(seconds / 3600)}時間前`;
}

export default function MobileVoiceCommander() {
  const [nodes, setNodes] = useState<FleetNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [supported, setSupported] = useState(false);
  const [sharedContext, setSharedContext] = useState<SharedCommandContext>(() => emptySharedCommandContext());
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);
  const recentCommands = useMemo(() => sharedContext.history.slice(-4).reverse(), [sharedContext]);
  const contextCandidates = useMemo(() => getSafeContextCandidates(sharedContext), [sharedContext]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jarvis/state", { cache: "no-store" });
      const body = await response.json() as StatePayload;
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      const fleet = body.fleet ?? [];
      const rememberedTarget = loadSharedCommandContext().targetNodeId;
      setNodes(fleet);
      setSelectedNodeId((current) => current && fleet.some((node) => node.id === current)
        ? current
        : rememberedTarget && fleet.some((node) => node.id === rememberedTarget)
          ? rememberedTarget
          : fleet.find((node) => node.status === "ready")?.id ?? fleet[0]?.id ?? "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "JARVIS状態を取得できません");
    }
  }, []);

  useEffect(() => {
    setSupported(Boolean(recognitionConstructor()));
    setSharedContext(loadSharedCommandContext());
    void refresh();
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, [refresh]);

  useEffect(() => {
    if (selectedNodeId && sharedContext.targetNodeId !== selectedNodeId) {
      setSharedContext(saveSharedTargetNode(selectedNodeId));
    }
  }, [selectedNodeId, sharedContext.targetNodeId]);

  function selectNode(value: string) {
    setSelectedNodeId(value);
    setSharedContext(saveSharedTargetNode(value));
  }

  function selectHistoryReference(id: string) {
    setSharedContext(selectSharedHistoryEntry(id));
    setError("");
    setMessage("参照する履歴を選択しました。まだ端末操作は送信していません。");
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  function startListening() {
    if (listening) return;
    setError("");
    setMessage("");
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      setSupported(false);
      setError("このブラウザは音声入力に対応していません。文字入力を使ってください。");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      setListening(false);
      setInterimTranscript("");
      const reason = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "マイク利用が許可されませんでした。ブラウザ設定を確認するか文字入力を使ってください。"
        : `音声入力に失敗しました${event.error ? `: ${event.error}` : ""}`;
      setError(reason);
    };
    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript?.trim() ?? "";
        if (!text) continue;
        if (result.isFinal) finalText += `${finalText ? " " : ""}${text}`;
        else interimText += `${interimText ? " " : ""}${text}`;
      }
      if (finalText) setTranscript((current) => `${current}${current ? " " : ""}${finalText}`.trim());
      setInterimTranscript(interimText);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (cause) {
      recognitionRef.current = null;
      setListening(false);
      setError(cause instanceof Error ? cause.message : "音声入力を開始できませんでした");
    }
  }

  async function executeTranscript() {
    const text = transcript.trim();
    const currentContext = { ...loadSharedCommandContext(), targetNodeId: selectedNodeId || undefined };
    const reference = resolveSafeContextReference(text, currentContext);
    if (reference.kind === "rejected") {
      setError(reference.message);
      setSharedContext(recordSharedCommand({ source: "voice", command: text, outcome: "unsupported", targetNodeId: selectedNodeId || undefined }));
      return;
    }
    const effectiveText = reference.kind === "resolved" ? reference.command : text;
    const parsed = parseSafeMobileCommand(effectiveText);
    if (!parsed.ok) {
      setError(parsed.message);
      setSharedContext(recordSharedCommand({
        source: "voice",
        command: text,
        detail: reference.kind === "resolved" ? `参照元: ${effectiveText}` : undefined,
        outcome: parsed.reason === "protected" ? "blocked" : "unsupported",
        targetNodeId: selectedNodeId || undefined,
      }));
      return;
    }
    if (!selectedNodeId) {
      setError("操作する端末を選択してください。");
      setSharedContext(recordSharedCommand({ source: "voice", command: text, outcome: "failed" }));
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "device-task",
          type: parsed.task.type,
          payload: parsed.task.payload,
          targetNodeId: selectedNodeId,
          priority: "high",
        }),
      });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setMessage(`${selectedNode?.label ?? "端末"}へ確認済みの音声指示を送信しました。`);
      setSharedContext(recordSharedCommand({
        source: "voice",
        command: text,
        detail: reference.kind === "resolved" ? `参照元: ${effectiveText}` : undefined,
        outcome: "sent",
        targetNodeId: selectedNodeId,
      }));
      setTranscript("");
      setInterimTranscript("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "音声指示を送信できませんでした");
      setSharedContext(recordSharedCommand({
        source: "voice",
        command: text,
        detail: reference.kind === "resolved" ? `参照元: ${effectiveText}` : undefined,
        outcome: "failed",
        targetNodeId: selectedNodeId,
      }));
    } finally {
      setBusy(false);
    }
  }

  const needsLogin = error.includes("オーナー認証") || error.includes("401");

  return (
    <main className="commander-shell voice-commander-shell">
      <header className="commander-header">
        <div><div className="commander-kicker">JARVIS VOICE</div><h1>音声司令</h1></div>
        <a className="commander-link" href="/jarvis/mobile">文字司令へ</a>
      </header>

      <section className="commander-install">
        <strong>押している間だけ音声入力</strong>
        <span>マイクは自動起動しません。認識した文字を確認して「この指示を実行」を押すまで端末操作は送信されません。</span>
      </section>

      {needsLogin && <a className="commander-login" href="/jarvis/login?next=/jarvis/mobile/voice">オーナー認証する</a>}
      {error && !needsLogin && <div className="commander-error" role="alert">{error}</div>}
      {message && <div className="commander-success" role="status">{message}</div>}

      <section className="commander-card">
        <div className="commander-card-title"><span>操作する端末</span><button type="button" onClick={() => void refresh()} disabled={busy}>更新</button></div>
        <select value={selectedNodeId} onChange={(event) => selectNode(event.target.value)} disabled={busy}>
          <option value="">端末を選択</option>
          {nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.status}</option>)}
        </select>
      </section>

      <section className="commander-card voice-input-card">
        <div className="commander-card-title"><span>Push-to-talk</span><small>{supported ? "対応" : "未対応"}</small></div>
        <button
          className={`voice-ptt ${listening ? "listening" : ""}`}
          type="button"
          disabled={!supported || busy}
          aria-pressed={listening}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startListening(); }}
          onPointerUp={() => stopListening()}
          onPointerCancel={() => stopListening()}
          onKeyDown={(event) => { if (!event.repeat && (event.key === " " || event.key === "Enter")) { event.preventDefault(); startListening(); } }}
          onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); stopListening(); } }}
        >
          {listening ? "話してください" : "押して話す"}
        </button>
        {!supported && <p className="commander-hint">この環境ではSpeechRecognitionを利用できません。文字司令画面を使ってください。</p>}

        <label className="voice-caption-label" htmlFor="voice-transcript">認識字幕</label>
        <textarea
          id="voice-transcript"
          value={[transcript, interimTranscript].filter(Boolean).join(transcript && interimTranscript ? " " : "")}
          onChange={(event) => { setTranscript(event.target.value); setInterimTranscript(""); }}
          placeholder="ここに認識した音声が文字で表示されます"
          aria-live="polite"
        />
        {interimTranscript && <p className="voice-interim" aria-live="polite">認識中: {interimTranscript}</p>}
        <button className="commander-primary" type="button" disabled={busy || !transcript.trim() || listening} onClick={() => void executeTranscript()}>
          この指示を実行
        </button>
        <button className="voice-clear" type="button" disabled={busy || listening || (!transcript && !interimTranscript)} onClick={() => { setTranscript(""); setInterimTranscript(""); setError(""); }}>
          字幕をクリア
        </button>
        <p className="commander-hint">「さっきのやつ」「2番目」は同じ端末の安全な履歴だけを再解釈します。「これ」は下で参照対象を選択してから、必ず「この指示を実行」で確定します。保護対象は音声から実行も承認もしません。</p>
      </section>

      <section className="commander-card">
        <div className="commander-card-title"><span>共通コマンド履歴</span><small>音声＋文字</small></div>
        <div className="commander-tasks" aria-live="polite">
          {recentCommands.map((entry) => {
            const candidate = contextCandidates.find((item) => item.entry.id === entry.id);
            const selected = sharedContext.selectedHistoryId === entry.id;
            return (
              <div key={entry.id}>
                <span>{candidate ? `${candidate.index}番目 · ` : ""}{entry.source === "voice" ? "音声" : "文字"}: {entry.command}</span>
                <strong>{entry.outcome}</strong>
                <small>{shortAge(entry.createdAt)}</small>
                {candidate && <button type="button" disabled={busy || listening || selected} onClick={() => selectHistoryReference(entry.id)}>{selected ? "これに選択中" : "これを選択"}</button>}
              </div>
            );
          })}
          {!recentCommands.length && <div className="commander-empty">共通コマンド履歴はまだありません</div>}
        </div>
      </section>
    </main>
  );
}
