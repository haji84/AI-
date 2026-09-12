import JarvisConsole from "./JarvisConsole.tsx";

export const dynamic = "force-dynamic";

export default function JarvisPage() {
  return (
    <main className="dashboard-shell">
      <header style={{ marginBottom: 18 }}>
        <p className="eyebrow">JARVIS CONTROL CENTER</p>
        <h1>JARVIS ダッシュボード</h1>
        <p className="muted">① 端末を登録 → ② 作業を設定 → ③ 実行。端末管理と実行状況をここだけで確認できます。</p>
      </header>
      <nav className="jarvis-button-row" style={{ marginBottom: 18 }} aria-label="JARVISメニュー">
        <a className="button secondary" href="#enrollment">＋ 端末を登録</a>
        <a className="button secondary" href="/jarvis/qa">作業を実行</a>
        <a className="button secondary" href="#fleet">端末一覧</a>
        <a className="button secondary" href="#remote">遠隔操作</a>
      </nav>
      <JarvisConsole />
    </main>
  );
}
