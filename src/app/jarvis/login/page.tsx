export default async function JarvisLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  const next = params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/jarvis";
  return (
    <main className="dashboard-shell">
      <div className="jarvis-toolbar">
        <div>
          <p className="eyebrow">JARVIS OWNER</p>
          <h1>オーナー認証</h1>
          <p className="muted">このブラウザをJARVISのオーナー端末として認証します。通常は初回だけです。</p>
        </div>
        <a className="button secondary" href="/jarvis">戻る</a>
      </div>
      <section className="panel jarvis-section" style={{ maxWidth: 560, margin: "32px auto" }}>
        <div className="section-heading"><div><p className="section-kicker">OWNER</p><h2>認証コードを入力</h2></div></div>
        {params.error === "1" && <div className="jarvis-alert"><strong>認証失敗</strong><span>コードが違います。</span></div>}
        <form action="/api/owner-login" method="post" className="jarvis-task-form">
          <input type="hidden" name="next" value={next} />
          <input aria-label="JARVISオーナー認証コード" name="passcode" type="password" placeholder="JARVISオーナー認証コード" autoComplete="current-password" required />
          <button className="button" type="submit">この端末を認証</button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>認証コードはVercelの <code>JARVIS_OWNER_SECRET</code> に設定した値です。未設定なら旧 <code>AI_COMPANY_OWNER_SECRET</code> も互換利用できます。</p>
      </section>
    </main>
  );
}
