import JarvisLocalSettings from "./JarvisLocalSettings";

export default function JarvisSettingsPage() {
  return (
    <main className="jarvis-screen-page">
      <div className="jarvis-screen-heading">
        <div>
          <p className="eyebrow">CONTROL SURFACE</p>
          <h1>設定</h1>
          <p className="muted">JARVISの表示と操作面を整える。権限や秘密情報を変える設定はHuman Gateの外へ出さない。</p>
        </div>
      </div>
      <JarvisLocalSettings />
      <section className="panel jarvis-settings-card">
        <div>
          <p className="eyebrow">SECURITY BOUNDARY</p>
          <h2>保護対象</h2>
          <p>認証情報、端末権限、ネットワーク公開範囲、課金、破壊的操作、Human Gateルールはこのローカル表示設定から変更できない。</p>
        </div>
      </section>
      <p className="jarvis-boundary-note">20テーマ、Persona/Voice/Color/Layout分離、Widget編集、Privacy/Distance/Accessibility等はP5の後続Requirementとして残る。</p>
    </main>
  );
}
