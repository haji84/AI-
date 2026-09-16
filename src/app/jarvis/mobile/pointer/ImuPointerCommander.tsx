"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_POINTER_POSITION,
  calibrationFromSample,
  canActivatePointerTarget,
  nearestPointerTarget,
  projectOrientation,
  type ImuPointerStatus,
  type OrientationCalibration,
  type OrientationSample,
  type PointerPosition,
} from "./imu-pointer.ts";

type PermissionCapableOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

type SafeTarget = {
  id: string;
  label: string;
  description: string;
  href: string;
  x: number;
  y: number;
};

const SAFE_TARGETS: SafeTarget[] = [
  { id: "text", label: "文字司令", description: "文字で安全な端末指示を確認して送信", href: "/jarvis/mobile", x: 22, y: 28 },
  { id: "voice", label: "音声司令", description: "Push-to-talkで音声を字幕確認して送信", href: "/jarvis/mobile/voice", x: 78, y: 28 },
  { id: "home", label: "JARVISホーム", description: "司令センターへ戻る", href: "/jarvis", x: 50, y: 76 },
];

const STATUS_LABELS: Record<ImuPointerStatus, string> = {
  idle: "停止中",
  requesting: "許可確認中",
  active: "IMU入力中",
  denied: "センサー許可が拒否されました",
  unsupported: "このブラウザでは利用できません",
  error: "センサー入力エラー",
};

export default function ImuPointerCommander() {
  const [status, setStatus] = useState<ImuPointerStatus>("idle");
  const [pointer, setPointer] = useState<PointerPosition>(DEFAULT_POINTER_POSITION);
  const [selectedTargetId, setSelectedTargetId] = useState<string>(SAFE_TARGETS[0].id);
  const [message, setMessage] = useState("IMUはOFFです。通常のタップ操作はいつでも使えます。");
  const calibrationRef = useRef<OrientationCalibration | null>(null);
  const lastSampleRef = useRef<OrientationSample | null>(null);
  const handlerRef = useRef<((event: DeviceOrientationEvent) => void) | null>(null);

  const selectedTarget = useMemo(
    () => SAFE_TARGETS.find((target) => target.id === selectedTargetId) ?? SAFE_TARGETS[0],
    [selectedTargetId],
  );

  function detachSensor() {
    if (handlerRef.current && typeof window !== "undefined") {
      window.removeEventListener("deviceorientation", handlerRef.current, true);
    }
    handlerRef.current = null;
    calibrationRef.current = null;
    lastSampleRef.current = null;
  }

  useEffect(() => () => detachSensor(), []);

  function stopSensor() {
    detachSensor();
    setStatus("idle");
    setPointer(DEFAULT_POINTER_POSITION);
    setMessage("IMUを停止しました。通常のタップ・キーボード操作はそのまま使えます。");
  }

  function handleOrientation(event: DeviceOrientationEvent) {
    const sample: OrientationSample = { beta: event.beta, gamma: event.gamma };
    lastSampleRef.current = sample;
    if (!calibrationRef.current) {
      calibrationRef.current = calibrationFromSample(sample);
      if (!calibrationRef.current) return;
      setMessage("基準位置を自動設定しました。端末をゆっくり傾けてポインターを動かせます。");
      return;
    }

    setPointer((previous) => {
      const next = projectOrientation(sample, calibrationRef.current!, previous);
      if (!next) return previous;
      const nearest = nearestPointerTarget(next, SAFE_TARGETS);
      if (nearest) setSelectedTargetId(nearest);
      return next;
    });
  }

  async function startSensor() {
    if (status === "active" || status === "requesting") return;
    setMessage("");
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      setStatus("unsupported");
      setMessage("IMUに対応していません。下のタップ・キーボード操作を使ってください。");
      return;
    }

    setStatus("requesting");
    try {
      const OrientationEvent = window.DeviceOrientationEvent as PermissionCapableOrientationEvent;
      if (typeof OrientationEvent.requestPermission === "function") {
        const permission = await OrientationEvent.requestPermission();
        if (permission !== "granted") {
          setStatus("denied");
          setMessage("センサー許可が拒否されました。設定を変えなくても通常操作は使えます。");
          return;
        }
      }

      detachSensor();
      handlerRef.current = handleOrientation;
      window.addEventListener("deviceorientation", handleOrientation, true);
      setStatus("active");
      setMessage("IMU入力を開始しました。センサーデータはこのブラウザ内だけで処理し、送信しません。");
    } catch (cause) {
      detachSensor();
      setStatus("error");
      setMessage(cause instanceof Error ? `IMUを開始できません: ${cause.message}` : "IMUを開始できませんでした。");
    }
  }

  function recalibrate() {
    const calibration = lastSampleRef.current ? calibrationFromSample(lastSampleRef.current) : null;
    if (!calibration) {
      setMessage("有効なセンサー値がまだありません。端末を静止してから再度補正してください。");
      return;
    }
    calibrationRef.current = calibration;
    setPointer(DEFAULT_POINTER_POSITION);
    setMessage("現在の端末角度を中央として再補正しました。");
  }

  function cycleTarget(direction: 1 | -1) {
    const currentIndex = Math.max(0, SAFE_TARGETS.findIndex((target) => target.id === selectedTargetId));
    const nextIndex = (currentIndex + direction + SAFE_TARGETS.length) % SAFE_TARGETS.length;
    setSelectedTargetId(SAFE_TARGETS[nextIndex].id);
  }

  function activateSelectedTarget() {
    if (!canActivatePointerTarget(status, selectedTargetId)) return;
    window.location.assign(selectedTarget.href);
  }

  return (
    <main className="imu-shell">
      <header className="imu-header">
        <div>
          <div className="imu-kicker">JARVIS LOCAL POINTER</div>
          <h1>スマホ傾きポインター</h1>
        </div>
        <a href="/jarvis/mobile">文字司令へ</a>
      </header>

      <section className="imu-status" aria-live="polite">
        <strong>センサー: {STATUS_LABELS[status]}</strong>
        <span>{message}</span>
      </section>

      <section className="imu-safety">
        <strong>動かすだけでは実行しません</strong>
        <span>傾きは画面内の候補選択だけに使います。端末操作、承認、権限変更、Human Gateはポインター移動では実行できません。</span>
      </section>

      <section
        className="imu-stage"
        tabIndex={0}
        aria-label="傾きポインター操作エリア"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); cycleTarget(1); }
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); cycleTarget(-1); }
          if (event.key === "Enter" && canActivatePointerTarget(status, selectedTargetId)) { event.preventDefault(); activateSelectedTarget(); }
        }}
      >
        <div className="imu-pointer" style={{ left: `${pointer.x}%`, top: `${pointer.y}%` }} aria-hidden="true" />
        {SAFE_TARGETS.map((target) => (
          <button
            key={target.id}
            type="button"
            className={`imu-target ${selectedTargetId === target.id ? "selected" : ""}`}
            style={{ left: `${target.x}%`, top: `${target.y}%` }}
            aria-pressed={selectedTargetId === target.id}
            onClick={() => setSelectedTargetId(target.id)}
          >
            <strong>{target.label}</strong>
            <span>{target.description}</span>
          </button>
        ))}
      </section>

      <section className="imu-controls">
        {status === "active" ? (
          <button type="button" className="imu-stop" onClick={stopSensor}>IMUを停止</button>
        ) : (
          <button type="button" className="imu-start" disabled={status === "requesting"} onClick={() => void startSensor()}>
            {status === "requesting" ? "許可を確認中" : "IMUポインターを開始"}
          </button>
        )}
        <button type="button" onClick={recalibrate} disabled={status !== "active"}>中央を再補正</button>
        <button type="button" className="imu-activate" onClick={activateSelectedTarget} disabled={!canActivatePointerTarget(status, selectedTargetId)}>
          選択中の「{selectedTarget.label}」を開く
        </button>
      </section>

      <section className="imu-fallback">
        <strong>センサーなしでも操作できます</strong>
        <span>候補をタップしてから「開く」を押すか、操作エリアで矢印キー＋Enterを使えます。センサー拒否や非対応でも機能停止しません。</span>
      </section>
    </main>
  );
}