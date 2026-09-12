import JarvisConsole from "./JarvisConsole.tsx";

export const dynamic = "force-dynamic";

export default function JarvisPage() {
  return (
    <main className="dashboard-shell">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <a className="button secondary" href="/jarvis/qa">2 URL 自動判定を開く</a>
      </div>
      <JarvisConsole />
    </main>
  );
}
