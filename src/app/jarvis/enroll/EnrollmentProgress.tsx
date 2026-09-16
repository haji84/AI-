"use client";
import { useEffect, useState } from "react";
import type { RemoteInventoryDevice } from "../../../jarvis/remote-device-inventory";

export default function EnrollmentProgress() {
  const [devices, setDevices] = useState<RemoteInventoryDevice[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/jarvis/remote", { cache: "no-store", signal: abort.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || "登録状況を確認できません");
        if (!stopped) { setDevices((body.devices as RemoteInventoryDevice[]).filter(device => device.transport === "worker")); setError((body.warnings || []).join(" / ")); }
      } catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : "接続を確認してください"); }
      finally { if (!stopped) timer = setTimeout(refresh, 3_000); }
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); abort.abort(); };
  }, []);
  return <section className="panel jarvis-section" style={{ maxWidth: 860, margin: "0 auto 24px" }}>
    <h2>登録済み端末 {devices.length}台</h2>
    <p>登録するとここに自動で追加され、遠隔操作の端末一覧にも表示されます。追加の登録操作は不要です。</p>
    {error && <p role="alert">{error}（表示は最後に取得した情報です）</p>}
    <ul>{devices.map(device => <li key={device.serial}><strong>{device.label}</strong><p>{device.reason}</p></li>)}</ul>
    <a className="button" href="/jarvis">遠隔操作を開く</a>
  </section>;
}
