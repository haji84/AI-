import JarvisConsole from "./JarvisConsole.tsx";

export const dynamic = "force-dynamic";

export default function JarvisPage() {
  return (
    <main className="dashboard-shell">
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginBottom: 10, flexWrap: "wrap" }}>
        <a className="button" href="/jarvis/enroll">＋ 端末を登録</a>
        <a className="button secondary" href="/jarvis/qa">2 URL 自動実行</a>
        <a className="button secondary" href="/jarvis/login?next=/jarvis">オーナー認証</a>
      </div>
      <JarvisConsole />
    </main>
  );
}
