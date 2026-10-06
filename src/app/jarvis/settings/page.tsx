import JarvisAccessibilityControls from "../JarvisAccessibilityControls";
import JarvisLocalSettings from "./JarvisLocalSettings";
import JarvisOperatorGuide from "./JarvisOperatorGuide";
import JarvisScreenLayoutProfilesSettings from "./JarvisScreenLayoutProfiles";
import TrustedDeviceSettings from "./TrustedDeviceSettings";
import GoriqThemeSettings from "./GoriqThemeSettings";
import GoriqVoiceSettings from "./GoriqVoiceSettings";

export default function JarvisSettingsPage() {
  return (
    <main className="jarvis-screen-page">
      <div className="jarvis-screen-heading">
        <div>
          <p className="eyebrow">CONTROL SURFACE</p>
          <h1>設定</h1>
          <p className="muted">GORIQの表示と操作面を整える。権限や秘密情報を変える設定はHuman Gateの外へ出さない。</p>
        </div>
      </div>
      <GoriqThemeSettings />
      <GoriqVoiceSettings />
      <JarvisOperatorGuide />
      <TrustedDeviceSettings />
      <JarvisLocalSettings />
      <JarvisAccessibilityControls />
      <JarvisScreenLayoutProfilesSettings />
      <section className="panel jarvis-settings-card">
        <div>
          <p className="eyebrow">SECURITY BOUNDARY</p>
          <h2>保護対象</h2>
          <p>認証情報、端末権限、ネットワーク公開範囲、課金、破壊的操作、Human Gateルールはこのローカル表示設定から変更できない。</p>
        </div>
      </section>
      <p className="jarvis-boundary-note">Widget編集、検索、画面別レイアウト、Focus/Distance/Privacy、Read-only/Kiosk、アクセシビリティ表示設定は実装済み。声はAivisSpeech Engine優先・VOICEVOX Engine予備のローカル経路を使い、未検出時は文字応答へ明示的に退避する。実機音質は接続した音声モデルごとに確認する。</p>
    </main>
  );
}
