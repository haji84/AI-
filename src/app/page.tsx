const decisions = [
  {
    title: "本番反映の承認",
    detail: "高リスク操作のみ、ここに表示されます。",
    risk: "HIGH",
  },
];

const activity = [
  { label: "自動処理", value: "稼働中", tone: "good" },
  { label: "低リスクPR", value: "自動マージ対象", tone: "good" },
  { label: "中リスク", value: "自動検証", tone: "watch" },
  { label: "人間判断", value: "例外のみ", tone: "alert" },
];

export default function Home() {
  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI COMPANY CONTROL</p>
          <h1>AI会社 ダッシュボード</h1>
          <p className="muted">普段は自動。あなたは例外だけ判断。</p>
        </div>
        <div className="status-pill"><span className="status-dot" />自律運転中</div>
      </header>

      <section className="hero-grid" aria-label="運用状況">
        {activity.map((item) => (
          <article className="metric-card" key={item.label}>
            <span>{item.label}</span>
            <strong className={`tone-${item.tone}`}>{item.value}</strong>
          </article>
        ))}
      </section>

      <section className="decision-section">
        <div className="section-heading">
          <div>
            <p className="section-kicker">HUMAN GATE</p>
            <h2>あなたの判断が必要</h2>
          </div>
          <span className="count-badge">{decisions.length}</span>
        </div>

        {decisions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✓</div>
            <div>
              <strong>判断待ちはありません</strong>
              <p>AI社員が自動で作業を継続しています。</p>
            </div>
          </div>
        ) : (
          <div className="decision-list">
            {decisions.map((item) => (
              <article className="decision-card" key={item.title}>
                <div className="decision-main">
                  <span className="risk-badge">{item.risk}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                  </div>
                </div>
                <div className="decision-actions">
                  <button className="button secondary" type="button">詳細</button>
                  <button className="button primary" type="button">承認</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="lower-grid">
        <article className="panel">
          <div className="panel-heading">
            <h2>自動処理の流れ</h2>
            <span>LOW / MEDIUM</span>
          </div>
          <ol className="flow-list">
            <li><b>1</b><span>ゴールから次の作業を決定</span></li>
            <li><b>2</b><span>AI社員が実行</span></li>
            <li><b>3</b><span>テスト・レビュー・CIで自動検証</span></li>
            <li><b>4</b><span>安全なら次へ。高リスクだけあなたへ。</span></li>
          </ol>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <h2>Human Gate方針</h2>
            <span>例外運用</span>
          </div>
          <div className="risk-table">
            <div><span className="risk low">LOW</span><p>自動実行</p></div>
            <div><span className="risk medium">MEDIUM</span><p>自動検証後に継続</p></div>
            <div><span className="risk high">HIGH</span><p>あなたが判断</p></div>
            <div><span className="risk critical">CRITICAL</span><p>自動実行禁止</p></div>
          </div>
        </article>
      </section>
    </main>
  );
}
