const PRODUCT_PHASES = [
  ["P0", "仕様監査", "Requirement Ledgerで実装・Evidenceを照合"],
  ["P1-P4", "接続・復旧・Remote Assist・Fleet", "ソフト実装を継続し、実機必須項目はPHYSICAL/RECOVERY証拠待ち"],
  ["P5-P10", "UIから製品受入まで", "未完了フェーズを順次実装・検証"],
] as const;

export default function JarvisResearchPage() {
  return (
    <main className="jarvis-screen-page">
      <div className="jarvis-screen-heading">
        <div>
          <p className="eyebrow">EVIDENCE LAB</p>
          <h1>リサーチ</h1>
          <p className="muted">製品完成のEvidenceと、R1-R20の研究検証を混ぜずに管理する。</p>
        </div>
      </div>

      <section className="jarvis-info-grid">
        <article className="panel jarvis-info-card">
          <span className="jarvis-node-status ready">PRODUCT TRACK</span>
          <h2>GORIQ Product Completion</h2>
          <p>Issue #681のP0-P10が製品トラック。CODE/UNIT/INTEGRATIONとPHYSICAL/RECOVERYを別Evidenceとして扱い、必要な実機確認が無い項目を完成扱いにしない。</p>
          <div className="jarvis-research-list">
            {PRODUCT_PHASES.map(([phase, title, detail]) => (
              <div key={phase}><strong>{phase} {title}</strong><small>{detail}</small></div>
            ))}
          </div>
        </article>

        <article className="panel jarvis-info-card jarvis-research-track">
          <span className="jarvis-node-status needs-human">RESEARCH TRACK</span>
          <h2>Research Ops R1-R20</h2>
          <p>R1-R20は製品完成とは別の科学的Evidenceプログラム。GORIQの製品機能が完成しても、それだけでAGI達成とは扱わない。</p>
          <ul>
            <li>実測Evidenceのみを採用</li>
            <li>シミュレーションやCIを実世界Evidenceへ水増ししない</li>
            <li>正式なR20 Exit Ruleと独立検証が終わるまでAGI claimを行わない</li>
          </ul>
        </article>
      </section>

      <section className="panel jarvis-section">
        <h2>Evidenceルール</h2>
        <div className="jarvis-evidence-grid">
          <div><strong>CODE / UNIT</strong><span>実装と局所テスト</span></div>
          <div><strong>INTEGRATION</strong><span>結合された経路の検証</span></div>
          <div><strong>SECURITY</strong><span>fail-close、認証、replay等</span></div>
          <div><strong>PHYSICAL</strong><span>実端末・実環境での観測</span></div>
          <div><strong>RECOVERY</strong><span>再起動、切断、復旧の観測</span></div>
        </div>
      </section>
      <p className="jarvis-boundary-note">この画面は研究結果を捏造せず、製品トラックとR1-R20を明示的に分離するための表示面。研究PASSを自動生成する機能ではない。</p>
    </main>
  );
}
