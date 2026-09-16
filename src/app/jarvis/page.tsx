import JarvisConsole from "./JarvisConsole.tsx";
import OwnerLogin from "./OwnerLogin";
import { requireJarvisOwner } from "../api/jarvis/broker.ts";

export const dynamic = "force-dynamic";

export default async function JarvisPage() {
  if (!await requireJarvisOwner()) return <main className="dashboard-shell"><OwnerLogin /></main>;
  return (
    <main className="dashboard-shell">
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginBottom: 10, flexWrap: "wrap" }}>
        <a className="button" href="/jarvis/mobile">📱 iPhone司令塔</a>
        <a className="button" href="/jarvis/enroll">＋ 端末を登録</a>
        <a className="button secondary" href="/jarvis/recordings">遠隔記録</a>
        <a className="button secondary" href="/jarvis/qa">2 URL 自動実行</a>
      </div>
      <JarvisConsole />
    </main>
  );
}
