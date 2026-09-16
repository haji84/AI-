"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deriveJarvisConnectivityStatus, jarvisConnectivityCopy } from "./connectivity-status";

type ProbeState = "idle" | "pending" | "ok" | "failed" | "auth-required";

export default function JarvisConnectivityStatus() {
  const [browserOnline, setBrowserOnline] = useState(true);
  const [probe, setProbe] = useState<ProbeState>("idle");
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectTimer = useRef<number | null>(null);

  const runProbe = useCallback(async (showSync = false) => {
    if (!window.navigator.onLine) {
      setBrowserOnline(false);
      setProbe("idle");
      setReconnecting(false);
      return;
    }
    setBrowserOnline(true);
    if (showSync) setProbe("pending");
    try {
      const response = await fetch("/api/jarvis/state", { cache: "no-store" });
      if (response.status === 401) {
        setProbe("auth-required");
        setReconnecting(false);
        return;
      }
      if (!response.ok) {
        setProbe("failed");
        setReconnecting(true);
        return;
      }
      setProbe("ok");
      setReconnecting(false);
    } catch {
      if (!window.navigator.onLine) {
        setBrowserOnline(false);
        setProbe("idle");
        setReconnecting(false);
      } else {
        setProbe("failed");
        setReconnecting(true);
      }
    }
  }, []);

  useEffect(() => {
    setBrowserOnline(window.navigator.onLine);
    void runProbe(true);

    const onOffline = () => {
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      setBrowserOnline(false);
      setProbe("idle");
      setReconnecting(false);
    };
    const onOnline = () => {
      setBrowserOnline(true);
      setProbe("idle");
      setReconnecting(true);
      reconnectTimer.current = window.setTimeout(() => {
        reconnectTimer.current = null;
        void runProbe(true);
      }, 500);
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    const poll = window.setInterval(() => void runProbe(false), 15_000);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.clearInterval(poll);
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
    };
  }, [runProbe]);

  const status = deriveJarvisConnectivityStatus({ browserOnline, probe, reconnecting });
  const copy = useMemo(() => jarvisConnectivityCopy(status), [status]);

  return (
    <div className={`jarvis-connectivity-status ${status}`} role="status" aria-live="polite" aria-atomic="true">
      <span className="jarvis-connectivity-dot" aria-hidden="true" />
      <span><strong>{copy.label}</strong><small>{copy.detail}</small></span>
      {status === "auth-required" ? <a href="/jarvis/login?next=/jarvis">認証</a> : null}
    </div>
  );
}
