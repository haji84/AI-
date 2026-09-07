import { cookies } from "next/headers";
import ApprovalControls from "./ApprovalControls.tsx";
import { approvalReadinessFromEnv } from "./approval-readiness.ts";
import { readDashboardState } from "./dashboard-state.ts";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "./owner-auth.ts";

const PENDING_APPROVAL_COOKIE = "ai_company_approval_pending";

const activity = [
  { label: "自動処理", value: "稼働中", tone: "good" },
  { label: "低リスクPR", value: "自動マージ対象", tone: "good" },
  { label: "中リスク", value: "自動検証", tone: "watch" },
  { label: "人間判断", value: "例外のみ", tone: "alert" },
];

export const dynamic = "force-dynamic";

export default async function Home() {
  const dashboard = await readDashboardState();
  const decisions = dashboard.decisions;
  const readiness = approvalReadinessFromEnv();
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  const cookieStore = await cookies();
  const ownerAuthenticated = verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value);
  const pendingApprovalKey = cookieStore.get(PENDING_APPROVAL_COOKIE)?.value ?? null;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI COMPANY CONTROL</p>
          <h1>AI会社 ダッシュボード</h1>
          <p className="muted">普段は自動。あなたは例外だけ判断。</p>
        </div>
        <div className="status-pill"><span className="status-dot" />{dashboard.status}</div>
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

        <div className="panel" style={{ marginBottom: "1rem" }}>
          <div className="panel-heading">
            <h2>承認機能</h2>
            <span>{readiness.ready ? "準備完了" : "設定不足"}</span>
          </div>
          {readiness.ready ? (
            <p>{ownerAuthenticated ? "この端末はオーナー認証済みです。承認はボタン1つで行えます。" : "初回だけオーナー認証すると、この端末では以後ボタン1つで承認できます。"}</p>
          ) : (
            <p className="muted">不足: {readiness.missing.join(" / ")}</p>
          )}
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
              <article className="decision-card" key={`${item.risk}-${item.title}`}>
                <div className="decision-main">
                  <span className="risk-badge">{item.risk}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                    {item.reasons.length > 0 && <p className="muted">理由: {item.reasons.join(" / ")}</p>}
                  </div>
                </div>
                <div className="decision-actions">
                  {!readiness.ready ? (
                    <span className="muted">承認機能の設定が必要です</span>
                  ) : pendingApprovalKey === item.approvalKey ? (
                    <div className="approval-grace" role="status">
                      <strong>承認を送信しました</strong>
                      <p className="muted">AI社員の反映待ちです。二重送信はしません。</p>
                    </div>
                  ) : ownerAuthenticated ? (
                    <ApprovalControls approvalKey={item.approvalKey} />
                  ) : (
                    <form action="/api/owner-login" method="post">
                      <input aria-label="オーナー認証コード" name="passcode" placeholder="初回認証コード" required type="password" />
                      <button className="button secondary" type="submit">この端末をオーナー認証</button>
                    </form>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="lower-grid">
        <article className="panel">
          <div className="panel-heading">
            <h2>現在の自律実行</h2>
            <span>{dashboard.riskLevel ?? "未判定"}</span>
          </div>
          <ol className="flow-list">
            <li><b>1</b><span>状態: {dashboard.status}</span></li>
            <li><b>2</b><span>次: {dashboard.nextAction ?? "自動処理待ち"}</span></li>
            <li><b>3</b><span>検証: {dashboard.verificationSummary ?? "まだありません"}</span></li>
            <li><b>4</b><span>安全なら自動継続。HIGHだけあなたへ。</span></li>
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
