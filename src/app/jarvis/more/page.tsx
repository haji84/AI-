const items = [
  { href: "/jarvis/devices", label: "端末・ノード管理", description: "接続端末、状態、Capabilityを確認" },
  { href: "/jarvis/settings", label: "設定", description: "画面デザイン、配置、声、アクセシビリティ" },
  { href: "/jarvis/research", label: "リサーチ", description: "調査・Evidenceの確認" },
  { href: "/jarvis/mobile", label: "端末の詳細操作", description: "端末を直接指定する操作" },
  { href: "/jarvis/diagnostics", label: "自己診断", description: "接続・runtimeの診断" },
  { href: "/jarvis/recovery", label: "復旧", description: "復旧状態と安全な再開" },
] as const;

export default function GoriqMorePage() {
  return (
    <main className="jarvis-screen-page">
      <div className="jarvis-screen-heading">
        <div>
          <p className="eyebrow">MORE</p>
          <h1>その他</h1>
          <p className="muted">普段使い以外の管理・詳細画面をここにまとめます。</p>
        </div>
      </div>
      <section className="jarvis-info-grid">
        {items.map((item) => (
          <a className="panel jarvis-info-card" href={item.href} key={item.href}>
            <h2>{item.label}</h2>
            <p>{item.description}</p>
          </a>
        ))}
      </section>
    </main>
  );
}
