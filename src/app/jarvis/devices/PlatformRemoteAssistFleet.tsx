"use client";

import { useCallback, useEffect, useState } from "react";

type RemoteAssistDescriptor = {
  platform: string;
  capability: "VIEW_ONLY" | "CONTROLLABLE" | "FULL_MANAGEMENT" | null;
  availability: "available" | "temporarily-unavailable" | "unsupported";
  canView: boolean;
  canControl: boolean;
  fullManagementVerified: false;
  reason: string;
};

type FleetNode = {
  id: string;
  label: string;
  kind: string;
  status: string;
  lastSeenAt: string;
  remoteAssist?: RemoteAssistDescriptor;
};

type FleetState = { fleet?: FleetNode[]; message?: string };

function capabilityLabel(node: FleetNode): string {
  if (!node.remoteAssist?.capability) return "UNAVAILABLE";
  if (node.remoteAssist.availability !== "available") return `${node.remoteAssist.capability} · OFFLINE`;
  return node.remoteAssist.capability.replaceAll("_", " ");
}

export default function PlatformRemoteAssistFleet() {
  const [nodes, setNodes] = useState<FleetNode[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/jarvis/state", { cache: "no-store" });
      const body = await response.json() as FleetState;
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setNodes(body.fleet ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "端末能力を取得できません");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <main className="jarvis-console">
      <div className="jarvis-toolbar">
        <div>
          <p className="eyebrow">DEVICES / REMOTE ASSIST</p>
          <h1>端末能力</h1>
          <p className="muted">端末が自己申告した能力とGORIQの安全ポリシーから、遠隔閲覧・操作の範囲を保守的に表示します。</p>
        </div>
        <div className="jarvis-toolbar-actions">
          <button className="button secondary" disabled={loading} onClick={() => void refresh()}>更新</button>
          <a className="button" href="/jarvis#remote-controls">遠隔操作を開く</a>
          <a className="button secondary" href="/jarvis/teach">操作を教える・手順ライブラリ</a>
        </div>
      </div>

      {error && <div className="jarvis-alert"><strong>端末能力</strong><span>{error}</span></div>}

      <section className="panel jarvis-section">
        <div className="section-heading">
          <div><p className="section-kicker">CAPABILITY MATRIX</p><h2>Remote Assist</h2></div>
          <span className="count-badge neutral">{nodes.length}</span>
        </div>
        <p className="muted">FULL MANAGEMENTは、別途管理契約と実機検証が完了するまで表示しません。iPhone/iOSは汎用のremote-controlフラグだけで完全操作可能とは判定しません。</p>
        <div className="jarvis-table-wrap">
          <table className="jarvis-table">
            <thead><tr><th>端末</th><th>Platform</th><th>状態</th><th>Remote Assist</th><th>根拠</th></tr></thead>
            <tbody>
              {nodes.map((node) => <tr key={node.id}>
                <td><strong>{node.label}</strong><small>{node.id}</small></td>
                <td>{node.kind}</td>
                <td><span className={`jarvis-node-status ${node.status}`}>{node.status}</span></td>
                <td><span className="operation-badge">{capabilityLabel(node)}</span></td>
                <td><small>{node.remoteAssist?.reason ?? "Remote Assist descriptor unavailable"}</small></td>
              </tr>)}
              {!loading && nodes.length === 0 && <tr><td colSpan={5} className="jarvis-empty">登録済み端末はありません。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
