import JarvisConsole from "./JarvisConsole.tsx";
import JarvisWorkShell from "./JarvisWorkShell.tsx";
import OwnerLogin from "./OwnerLogin";
import { requireJarvisOwner } from "../api/jarvis/broker.ts";

export const dynamic = "force-dynamic";

const advancedTools = [
  { href: "/jarvis/mobile", label: "端末の詳細操作" },
  { href: "/jarvis/enroll", label: "端末を追加" },
  { href: "/jarvis/setup", label: "初回セットアップ" },
  { href: "/jarvis/diagnostics", label: "自己診断" },
  { href: "/jarvis/recovery", label: "復旧" },
  { href: "/jarvis/recordings", label: "遠隔記録" },
  { href: "/jarvis/qa", label: "URL自動実行" },
] as const;

export default async function JarvisPage() {
  if (!await requireJarvisOwner()) return <main className="dashboard-shell"><OwnerLogin /></main>;
  return (
    <main className="dashboard-shell">
      <JarvisWorkShell />
      <details style={{ marginTop: 16 }}>
        <summary className="button secondary">詳細・管理ツール</summary>
        <nav style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }} aria-label="詳細・管理ツール">
          {advancedTools.map((tool) => <a key={tool.href} className="button secondary" href={tool.href}>{tool.label}</a>)}
        </nav>
      </details>
      <details style={{ marginTop: 16 }}>
        <summary className="button secondary">従来の詳細操作</summary>
        <JarvisConsole />
      </details>
    </main>
  );
}
