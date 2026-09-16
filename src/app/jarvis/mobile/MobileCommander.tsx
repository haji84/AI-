"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  emptySharedCommandContext,
  loadSharedCommandContext,
  recordSharedCommand,
  saveSharedTargetNode,
  selectSharedHistoryEntry,
  type SharedCommandContext,
} from "./command-context";
import { getSafeContextCandidates, resolveSafeContextReference } from "./context-reference";
import { parseSafeMobileCommand } from "./voice-command";

type NodeItem = {
  id: string;
  label: string;
  kind: string;
  status: string;
  capabilities: string[];
  telemetry?: { batteryPercent?: number; charging?: boolean; network?: string };
  lastSeenAt: string;
};

type TaskItem = {
  id: string;
  type: string;
  status: string;
  targetNodeId?: string;
  assignedNodeId?: string;
  updatedAt: string;
};

type StatePayload = {
  fleet: NodeItem[];
  tasks: TaskItem[];
  stats: { registered: number; ready: number; offline: number; running: number; queued: number; needsHuman: number };
  message?: string;
};

type DeviceTaskType = "open-url" | "open-app" | "launch-settings" | "wake-device" | "device-status" | "show-notification" | "lock-device" | "reboot" | "ui-sequence";

const commonApps = [
  { label: "Chrome", packageName: "com.android.chrome" },
  { label: "スプレッドシート", packageName: "com.google.android.apps.docs.editors.sheets" },
  { label: "Googleマップ", packageName: "com.google.android.apps.maps" },
  { label: "YouTube", packageName: "com.google.android.youtube" },
  { label: "Gmail", packageName: "com.google.android.gm" },
];

function relativeTime(value?: string) {
  if (!value) return "-";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`;
  return `${Math.floor(seconds / 3600)}時間前`;
}

export default function MobileCommander() {
  const [state, setState] = useState<StatePayload | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [packageName, setPackageName] = useState("");
  const [notification, setNotification] = useState("");
  const [command, setCommand] = useState("");
  const [sequenceJson, setSequenceJson] = useState('[{"action":"wait","ms":500}]');
  const [standalone, setStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [sharedContext, setSharedContext] = useState<SharedCommandContext>(() => emptySharedCommandContext());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jarvis/state", { cache: "no-store" });
      const body = await response.json() as StatePayload;
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setState(body);
      setError("");
      const rememberedTarget = loadSharedCommandContext().targetNodeId;
      setSelectedNodeId((current) => {
        if (current && body.fleet.some((node) => node.id === current)) return current;
        if (rememberedTarget && body.fleet.some((node) => node.id === rememberedTarget)) return rememberedTarget;
        return body.fleet.find((node) => node.status === "ready")?.id ?? body.fleet[0]?.id ?? "";
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "JARVISに接続できません");
    }
  }, []);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true);
    setIsIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setSharedContext(loadSharedCommandContext());
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (selectedNodeId && sharedContext.targetNodeId !== selectedNodeId) {
      setSharedContext(saveSharedTargetNode(selectedNodeId));
    }
  }, [selectedNodeId, sharedContext.targetNodeId]);

  const selectedNode = useMemo(() => state?.fleet.find((node) => node.id === selectedNodeId), [state, selectedNodeId]);
  const recentTasks = useMemo(() => state?.tasks.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6) ?? [], [state]);
  const recentCommands = useMemo(() => sharedContext.history.slice(-4).reverse(), [sharedContext]);
  const contextCandidates = useMemo(() => getSafeContextCandidates(sharedContext), [sharedContext]);

  function selectNode(value: string) {
    setSelectedNodeId(value);
    setSharedContext(saveSharedTargetNode(value));
  }

  function selectHistoryReference(id: string) {
    setSharedContext(selectSharedHistoryEntry(id));
    setError("");
    setMessage("参照する履歴を選択しました。まだ端末操作は送信していません。");
  }

  async function sendTask(type: DeviceTaskType, payload: Record<string, unknown> = {}) {
    if (!selectedNodeId) {
      setError("操作するAndroidを選んでください");
      return false;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "device-task", type, payload, targetNodeId: selectedNodeId, priority: "high" }),
      });
      const body = await response.json() as { message?: string; task?: { id?: string } };
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setMessage(`${selectedNode?.label ?? "Android"}へ命令を送信しました`);
      await refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "命令を送信できませんでした");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runSimpleCommand() {
    const text = command.trim();
    if (!text) return;
    const currentContext = { ...loadSharedCommandContext(), targetNodeId: selectedNodeId || undefined };
    const reference = resolveSafeContextReference(text, currentContext);
    if (reference.kind === "rejected") {
      setError(reference.message);
      setSharedContext(recordSharedCommand({ source: "text", command: text, outcome: "unsupported", targetNodeId: selectedNodeId || undefined }));
      return;
    }
    const effectiveText = reference.kind === "resolved" ? reference.command : text;
    const parsed = parseSafeMobileCommand(effectiveText);
    if (!parsed.ok) {
      setError(parsed.message);
      setSharedContext(recordSharedCommand({
        source: "text",
        command: text,
        detail: reference.kind === "resolved" ? `参照元: ${effectiveText}` : undefined,
        outcome: parsed.reason === "protected" ? "blocked" : "unsupported",
        targetNodeId: selectedNodeId || undefined,
      }));
      return;
    }
    const ok = await sendTask(parsed.task.type, parsed.task.payload);
    setSharedContext(recordSharedCommand({
      source: "text",
      command: text,
      detail: reference.kind === "resolved" ? `参照元: ${effectiveText}` : undefined,
      outcome: ok ? "sent" : "failed",
      targetNodeId: selectedNodeId || undefined,
    }));
    if (ok) setCommand("");
  }

  async function runSequence() {
    try {
      const parsed = JSON.parse(sequenceJson) as unknown;
      if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 50) throw new Error("stepsは1〜50件にしてください");
      await sendTask("ui-sequence", { steps: parsed });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作シーケンスJSONが不正です");
    }
  }

  const needsLogin = error.includes("オーナー認証") || error.includes("401");

  return (
    <main className="commander-shell">
      <header className="commander-header">
        <div>
          <div className="commander-kicker">JARVIS COMMANDER</div>
          <h1>司令塔</h1>
        </div>
        <a className="commander-link" href="/jarvis">管理画面</a>
      </header>

      {isIos && !standalone && (
        <section className="commander-install">
          <strong>iPhoneにJARVISを入れる</strong>
          <span>Safariの共有ボタン →「ホーム画面に追加」→「追加」。以後はホーム画面のJARVISから起動できます。</span>
        </section>
      )}

      {needsLogin && <a className="commander-login" href="/jarvis/login?next=/jarvis/mobile">このiPhoneをオーナー認証する</a>}
      {error && !needsLogin && <div className="commander-error">{error}</div>}
      {message && <div className="commander-success">{message}</div>}

      <section className="commander-card commander-device-card">
        <div className="commander-card-title"><span>操作する端末</span><button onClick={() => void refresh()} disabled={busy}>更新</button></div>
        <select value={selectedNodeId} onChange={(event) => selectNode(event.target.value)}>
          <option value="">端末を選択</option>
          {(state?.fleet ?? []).map((node) => <option key={node.id} value={node.id}>{node.label} · {node.status}</option>)}
        </select>
        {selectedNode && (
          <div className="commander-device-meta">
            <span className={`dot ${selectedNode.status === "ready" ? "ready" : ""}`} />
            <strong>{selectedNode.status === "ready" ? "接続中" : selectedNode.status}</strong>
            <span>電池 {selectedNode.telemetry?.batteryPercent ?? "?"}%</span>
            <span>{relativeTime(selectedNode.lastSeenAt)}</span>
          </div>
        )}
      </section>

      <section className="commander-card">
        <div className="commander-card-title"><span>JARVISに指示</span></div>
        <div className="commander-command-row">
          <input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void runSimpleCommand(); }} placeholder="例：スプレッドシート開いて / さっきのやつ / 2番目" />
          <button disabled={busy || !command.trim()} onClick={() => void runSimpleCommand()}>実行</button>
        </div>
        <div className="commander-hint">「さっきのやつ」「2番目」は同じ端末の安全な履歴だけを再解釈します。「これ」は下で参照対象を選択してから実行してください。履歴を選ぶだけでは端末操作しません。</div>
        <div className="commander-tasks" aria-label="共通コマンド履歴">
          {recentCommands.map((entry) => {
            const candidate = contextCandidates.find((item) => item.entry.id === entry.id);
            const selected = sharedContext.selectedHistoryId === entry.id;
            return (
              <div key={entry.id}>
                <span>{candidate ? `${candidate.index}番目 · ` : ""}{entry.source === "voice" ? "音声" : "文字"}: {entry.command}</span>
                <strong>{entry.outcome}</strong>
                <small>{relativeTime(entry.createdAt)}</small>
                {candidate && <button type="button" disabled={busy || selected} onClick={() => selectHistoryReference(entry.id)}>{selected ? "これに選択中" : "これを選択"}</button>}
              </div>
            );
          })}
          {!recentCommands.length && <div className="commander-empty">共通コマンド履歴はまだありません</div>}
        </div>
      </section>

      <section className="commander-card">
        <div className="commander-card-title"><span>クイック操作</span></div>
        <div className="commander-grid">
          <button disabled={busy} onClick={() => void sendTask("wake-device")}>画面を起こす</button>
          <button disabled={busy} onClick={() => void sendTask("launch-settings", { screen: "settings" })}>設定を開く</button>
          <button disabled={busy} onClick={() => void sendTask("launch-settings", { screen: "wifi" })}>Wi-Fi</button>
          <button disabled={busy} onClick={() => void sendTask("device-status")}>端末状態</button>
        </div>
      </section>

      <section className="commander-card">
        <div className="commander-card-title"><span>アプリを開く</span></div>
        <div className="commander-app-grid">
          {commonApps.map((app) => <button key={app.packageName} disabled={busy} onClick={() => void sendTask("open-app", { packageName: app.packageName })}>{app.label}</button>)}
        </div>
        <div className="commander-command-row compact">
          <input value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder="Android package名" />
          <button disabled={busy || !packageName.trim()} onClick={() => void sendTask("open-app", { packageName: packageName.trim() })}>開く</button>
        </div>
      </section>

      <section className="commander-card">
        <div className="commander-card-title"><span>URL・通知</span></div>
        <div className="commander-stack">
          <div className="commander-command-row compact">
            <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." />
            <button disabled={busy || !url.startsWith("https://")} onClick={() => void sendTask("open-url", { url })}>URLを開く</button>
          </div>
          <div className="commander-command-row compact">
            <input value={notification} onChange={(event) => setNotification(event.target.value)} placeholder="端末へ通知" />
            <button disabled={busy || !notification.trim()} onClick={() => void sendTask("show-notification", { title: "JARVIS", message: notification.trim() })}>通知</button>
          </div>
        </div>
      </section>

      <details className="commander-card commander-advanced">
        <summary>詳細操作</summary>
        <p>自動操作が有効なAndroidで、最大50ステップを連続実行します。</p>
        <textarea value={sequenceJson} onChange={(event) => setSequenceJson(event.target.value)} spellCheck={false} />
        <div className="commander-example">例: [{'{'}"action":"click-text","text":"検索"{'}'},{'{'}"action":"wait","ms":500{'}'}]</div>
        <button className="commander-primary" disabled={busy} onClick={() => void runSequence()}>連続操作を実行</button>
        <div className="commander-danger-row">
          <button disabled={busy} onClick={() => { if (confirm("この端末をロックしますか？")) void sendTask("lock-device"); }}>端末をロック</button>
          <button disabled={busy} onClick={() => { if (confirm("Device Owner端末を再起動しますか？")) void sendTask("reboot"); }}>再起動</button>
        </div>
      </details>

      <section className="commander-card commander-status-card">
        <div className="commander-card-title"><span>稼働状況</span></div>
        <div className="commander-stats">
          <span><strong>{state?.stats.registered ?? 0}</strong>登録</span>
          <span><strong>{state?.stats.ready ?? 0}</strong>接続中</span>
          <span><strong>{state?.stats.running ?? 0}</strong>実行中</span>
          <span><strong>{state?.stats.queued ?? 0}</strong>待機</span>
        </div>
        <div className="commander-tasks">
          {recentTasks.map((task) => <div key={task.id}><span>{task.type}</span><strong>{task.status}</strong><small>{relativeTime(task.updatedAt)}</small></div>)}
          {!recentTasks.length && <div className="commander-empty">まだ命令履歴がありません</div>}
        </div>
      </section>

      <footer className="commander-footer">JARVIS Commander · iPhone司令塔</footer>
    </main>
  );
}
