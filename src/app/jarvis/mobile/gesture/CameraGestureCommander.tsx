"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  canAcceptGestureCandidate,
  classifyMotionGesture,
  nextTargetIndex,
  trimMotionWindow,
  type GestureDirection,
  type MotionPoint,
} from "./gesture-motion.ts";

type CameraStatus = "idle" | "requesting" | "active" | "denied" | "unsupported" | "error";

type SafeTarget = {
  id: string;
  label: string;
  description: string;
  href: string;
};

const SAFE_TARGETS: SafeTarget[] = [
  { id: "text", label: "文字司令", description: "文字で安全な指示を確認して送信", href: "/jarvis/mobile" },
  { id: "voice", label: "音声司令", description: "Push-to-talkと字幕で確認して送信", href: "/jarvis/mobile/voice" },
  { id: "pointer", label: "傾きポインター", description: "スマホIMUで安全な画面移動を選択", href: "/jarvis/mobile/pointer" },
  { id: "home", label: "GORIQホーム", description: "司令センターへ戻る", href: "/jarvis" },
];

const STATUS_LABELS: Record<CameraStatus, string> = {
  idle: "停止中",
  requesting: "カメラ許可確認中",
  active: "カメラ入力中",
  denied: "カメラ許可が拒否されました",
  unsupported: "このブラウザでは利用できません",
  error: "カメラ入力エラー",
};

const ANALYSIS_WIDTH = 96;
const ANALYSIS_HEIGHT = 72;
const PIXEL_DIFF_THRESHOLD = 72;
const MIN_CHANGED_PIXELS = 90;
const MAX_CHANGED_PIXELS = ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 0.65;

export default function CameraGestureCommander() {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [selectedTargetId, setSelectedTargetId] = useState(SAFE_TARGETS[0].id);
  const [message, setMessage] = useState("カメラはOFFです。タップ・キーボード操作はいつでも使えます。");
  const [lastGesture, setLastGesture] = useState<GestureDirection | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const cameraActiveRef = useRef(false);
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const motionPointsRef = useRef<MotionPoint[]>([]);
  const lastAcceptedAtRef = useRef(Number.NEGATIVE_INFINITY);

  const selectedTarget = useMemo(
    () => SAFE_TARGETS.find((target) => target.id === selectedTargetId) ?? SAFE_TARGETS[0],
    [selectedTargetId],
  );

  function clearAnalysisState() {
    previousFrameRef.current = null;
    motionPointsRef.current = [];
    lastAcceptedAtRef.current = Number.NEGATIVE_INFINITY;
    setLastGesture(null);
  }

  function releaseCamera() {
    cameraActiveRef.current = false;
    if (timerRef.current !== null && typeof window !== "undefined") {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    clearAnalysisState();
  }

  useEffect(() => () => {
    cameraActiveRef.current = false;
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    previousFrameRef.current = null;
    motionPointsRef.current = [];
  }, []);

  function cycleTarget(direction: GestureDirection) {
    setSelectedTargetId((currentTargetId) => {
      const currentIndex = Math.max(0, SAFE_TARGETS.findIndex((target) => target.id === currentTargetId));
      const nextIndex = nextTargetIndex(currentIndex, direction, SAFE_TARGETS.length);
      return SAFE_TARGETS[nextIndex].id;
    });
    setLastGesture(direction);
    setMessage("動き候補で画面内の選択だけを移動しました。まだ何も実行していません。");
  }

  function processFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!cameraActiveRef.current || !video || !canvas || video.readyState < 2) return;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    context.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const current = context.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT).data;
    const previous = previousFrameRef.current;
    previousFrameRef.current = new Uint8ClampedArray(current);
    if (!previous || previous.length !== current.length) return;

    let changed = 0;
    let sumX = 0;
    let sumY = 0;
    for (let index = 0; index < current.length; index += 4) {
      const diff = Math.abs(current[index] - previous[index])
        + Math.abs(current[index + 1] - previous[index + 1])
        + Math.abs(current[index + 2] - previous[index + 2]);
      if (diff < PIXEL_DIFF_THRESHOLD) continue;
      const pixel = index / 4;
      sumX += pixel % ANALYSIS_WIDTH;
      sumY += Math.floor(pixel / ANALYSIS_WIDTH);
      changed += 1;
    }

    if (changed < MIN_CHANGED_PIXELS || changed > MAX_CHANGED_PIXELS) return;
    const now = Date.now();
    const point: MotionPoint = {
      x: (sumX / changed) / ANALYSIS_WIDTH,
      y: (sumY / changed) / ANALYSIS_HEIGHT,
      at: now,
    };
    motionPointsRef.current = trimMotionWindow([...motionPointsRef.current, point], now);
    const candidate = classifyMotionGesture(motionPointsRef.current);
    if (!candidate || !canAcceptGestureCandidate(lastAcceptedAtRef.current, now)) return;

    lastAcceptedAtRef.current = now;
    motionPointsRef.current = [];
    cycleTarget(candidate.direction);
  }

  async function startCamera() {
    if (status === "active" || status === "requesting") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setMessage("カメラAPIに対応していません。通常のタップ・キーボード操作を使ってください。");
      return;
    }

    setStatus("requesting");
    setMessage("カメラ許可を確認しています。許可されるまで映像処理は開始しません。");
    try {
      releaseCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("camera preview unavailable");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      cameraActiveRef.current = true;
      setStatus("active");
      setMessage("カメラ入力中です。フレームはこのブラウザ内だけで粗い動き候補に変換し、保存・送信しません。");
      timerRef.current = window.setInterval(processFrame, 140);
    } catch (cause) {
      releaseCamera();
      if (cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError")) {
        setStatus("denied");
        setMessage("カメラ許可が拒否されました。設定を変えなくても通常操作は使えます。");
      } else {
        setStatus("error");
        setMessage("カメラを開始できませんでした。通常操作へフォールバックできます。");
      }
    }
  }

  function stopCamera() {
    releaseCamera();
    setStatus("idle");
    setMessage("カメラを停止しました。カメラ映像・解析データは保持していません。");
  }

  function activateSelectedTarget() {
    if (status === "requesting") return;
    window.location.assign(selectedTarget.href);
  }

  return (
    <main className="gesture-shell">
      <header className="gesture-header">
        <div>
          <div className="gesture-kicker">GORIQ LOCAL AIR GESTURE</div>
          <h1>カメラ動きポインター</h1>
        </div>
        <a href="/jarvis/mobile">文字司令へ</a>
      </header>

      <section className={`gesture-status ${status === "active" ? "camera-active" : ""}`} aria-live="polite">
        <strong>カメラ: {STATUS_LABELS[status]}</strong>
        <span>{message}</span>
        {status === "active" ? <b className="camera-indicator">● CAMERA ACTIVE · LOCAL ONLY</b> : null}
      </section>

      <section className="gesture-safety">
        <strong>動き候補だけでは実行しません</strong>
        <span>カメラの粗い動き判定は安全な画面候補の選択だけに使います。端末操作、承認、権限変更、Human Gate、破壊的操作はジェスチャーから実行できません。</span>
        <span>誤検知対策として移動量・軸優位・時間窓・1秒クールダウンを通した候補だけを採用し、最後は必ずタップまたはEnterで確定します。</span>
      </section>

      <section className="gesture-preview-wrap">
        <video ref={videoRef} className="gesture-preview" muted playsInline aria-label="ローカルカメラプレビュー" />
        <canvas ref={canvasRef} width={ANALYSIS_WIDTH} height={ANALYSIS_HEIGHT} className="gesture-analysis-canvas" aria-hidden="true" />
        <div className="gesture-local-policy">処理: 端末内のみ固定 · 保存なし · アップロードなし</div>
      </section>

      <section
        className="gesture-targets"
        tabIndex={0}
        aria-label="ジェスチャー候補選択エリア"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); cycleTarget("right"); }
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); cycleTarget("left"); }
          if (event.key === "Enter" && status !== "requesting") { event.preventDefault(); activateSelectedTarget(); }
        }}
      >
        {SAFE_TARGETS.map((target) => (
          <button
            key={target.id}
            type="button"
            className={`gesture-target ${selectedTargetId === target.id ? "selected" : ""}`}
            aria-pressed={selectedTargetId === target.id}
            onClick={() => setSelectedTargetId(target.id)}
          >
            <strong>{target.label}</strong>
            <span>{target.description}</span>
          </button>
        ))}
      </section>

      <section className="gesture-controls">
        {status === "active" ? (
          <button type="button" className="gesture-stop" onClick={stopCamera}>カメラを停止</button>
        ) : (
          <button type="button" className="gesture-start" disabled={status === "requesting"} onClick={() => void startCamera()}>
            {status === "requesting" ? "許可を確認中" : "カメラジェスチャーを開始"}
          </button>
        )}
        <button type="button" className="gesture-activate" onClick={activateSelectedTarget} disabled={status === "requesting"}>
          選択中の「{selectedTarget.label}」を開く
        </button>
      </section>

      <section className="gesture-fallback">
        <strong>実験的な粗い動き判定です</strong>
        <span>これは手の形を理解するAIではありません。カメラ内の大きな動き方向を端末内で推定する安全な入口です。最後の候補: {lastGesture ?? "なし"}。カメラ拒否・非対応でもタップとキーボードで操作できます。</span>
      </section>
    </main>
  );
}
