import CommandChat from "../../CommandChat";
import { requireJarvisOwner } from "../../api/jarvis/broker.ts";

export const dynamic = "force-dynamic";

export default async function GoriqNewDevelopmentPage() {
  const enabled = await requireJarvisOwner();
  return (
    <div className="jarvis-screen-page">
      <div className="jarvis-screen-heading">
        <div>
          <p className="eyebrow">NEW DEVELOPMENT</p>
          <h1>新規開発</h1>
          <p className="muted">作りたいものを会話で説明してください。仕様、設計、技術、完了条件を会話履歴として残しながら固めます。</p>
        </div>
      </div>
      {!enabled && <div className="jarvis-alert"><strong>オーナー認証が必要です</strong><a className="button secondary" href="/jarvis/login?next=/jarvis/new-development">認証する</a></div>}
      <section className="panel jarvis-section">
        <CommandChat enabled={enabled} />
      </section>
      <p className="jarvis-boundary-note">会話からの実行も既存のGoal/Gate/State権限に従います。秘密情報、課金、権限拡張、破壊的操作、Human Gateは会話だけで迂回できません。</p>
    </div>
  );
}
