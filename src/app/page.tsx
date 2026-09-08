import { cookies } from "next/headers";
import CommandChat from "./CommandChat.tsx";
import HumanGateActions from "./HumanGateActions.tsx";
import QuickControls from "./QuickControls.tsx";
import { approvalReadinessFromEnv } from "./approval-readiness.ts";
import { employeeRoster, readControlCenterData } from "./dashboard-data.ts";
import { readDashboardState } from "./dashboard-state.ts";
import { OWNER_SESSION_COOKIE, verifyOwnerSessionToken } from "./owner-auth.ts";

const PENDING_APPROVAL_COOKIE = "ai_company_approval_pending";

export const dynamic = "force-dynamic";

function fmt(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date(value));
}

export default async function Home() {
  const [dashboard, center] = await Promise.all([readDashboardState(), readControlCenterData()]);
  const readiness = approvalReadinessFromEnv();
  const ownerSecret = process.env.AI_COMPANY_OWNER_SECRET?.trim() || "";
  const cookieStore = await cookies();
  const ownerAuthenticated = verifyOwnerSessionToken(ownerSecret, cookieStore.get(OWNER_SESSION_COOKIE)?.value);
  const pendingApprovalKey = cookieStore.get(PENDING_APPROVAL_COOKIE)?.value ?? null;
  const controlsEnabled = ownerAuthenticated && readiness.ready;
  const currentTask = center.currentTask;
  const overdue = center.tasks.filter((task) => task.deadlineTone === "overdue").length;
  const soon = center.tasks.filter((task) => task.deadlineTone === "soon").length;
  const completed = center.history.filter((item) => item.conclusion === "success").length;
  const failed = center.history.filter((item) => item.conclusion === "failure").length;

  return (
    <main className="dashboard-shell" id="home">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI COMPANY CONTROL</p>
          <h1>AI会社 コントロールセンター</h1>
          <p className="muted">見る、指示する、承認する。ここだけで会社を動かす。</p>
        </div>
        <div className="status-pill"><span className="status-dot" />{dashboard.status}</div>
      </header>

      <section className="command-deck" id="operations" aria-label="操作とAI司令チャット">
        <article className="panel quick-top-panel">
          <div className="section-heading"><div><p className="section-kicker">QUICK</p><h2>クイック操作</h2></div><span className="operation-badge">最短操作</span></div>
          <QuickControls enabled={controlsEnabled}/>
        </article>
        <article className="panel command-panel">
          <div className="section-heading"><div><p className="section-kicker">COMMAND</p><h2>AI司令チャット</h2></div><span className="operation-badge">自然文OK</span></div>
          <p className="command-intro">やってほしいことをそのまま入力。AI社員の既存ループへ指示を渡します。</p>
          {!readiness.ready ? (
            <p className="inline-note">AI司令チャットの実行設定が不足しています。</p>
          ) : !ownerAuthenticated ? (
            <form action="/api/owner-login" method="post" className="decision-actions">
              <input aria-label="オーナー認証コード" name="passcode" placeholder="初回認証コード" required type="password"/>
              <button className="button secondary" type="submit">この端末を認証</button>
            </form>
          ) : (
            <p className="inline-note">✓ この端末はオーナー認証済みです。</p>
          )}
          <CommandChat enabled={controlsEnabled}/>
        </article>
      </section>

      <section className="summary-grid" aria-label="今日の状況">
        <article className="summary-card current-task-card">
          <span>現在のタスク</span>
          {currentTask ? <a href={currentTask.url} target="_blank" rel="noreferrer"><strong>{currentTask.title}</strong><small>#{currentTask.id}・タップしてタスクを開く ↗</small></a> : <strong>待機中</strong>}
        </article>
        <article className="summary-card"><span>進行中</span><strong>{center.tasks.length}</strong><small>タスク</small></article>
        <article className="summary-card"><span>期限注意</span><strong className={overdue || soon ? "text-warn" : ""}>{overdue + soon}</strong><small>期限超過 {overdue} / 間近 {soon}</small></article>
        <article className="summary-card"><span>判断待ち</span><strong className={dashboard.decisions.length ? "text-alert" : ""}>{dashboard.decisions.length}</strong><small>Human Gate</small></article>
        <article className="summary-card"><span>直近成功</span><strong>{completed}</strong><small>自動処理</small></article>
        <article className="summary-card"><span>エラー</span><strong className={failed ? "text-alert" : ""}>{failed}</strong><small>直近の自動処理</small></article>
      </section>

      {center.warnings.length > 0 && <section className="warning-strip" id="alerts"><strong>注意</strong><div>{center.warnings.map((item) => <span key={item}>{item}</span>)}</div></section>}

      <section className="control-layout">
        <div className="main-column">
          <section className="panel" id="tasks">
            <div className="section-heading"><div><p className="section-kicker">TASKS</p><h2>現在進行中のタスク</h2></div><span className="count-badge neutral">{center.tasks.length}</span></div>
            <div className="task-list">
              {center.tasks.slice(0, 8).map((task) => <a className="task-row" href={task.url} key={task.id} target="_blank" rel="noreferrer">
                <div className="task-copy"><span className="task-id">#{task.id}</span><strong>{task.title}</strong><small>更新 {fmt(task.updatedAt)}</small></div>
                <div className="task-meta"><span className={`deadline ${task.deadlineTone}`}>{task.deadlineLabel}</span>{task.progress !== null && <span>{task.progress}%</span>}<b>›</b></div>
              </a>)}
              {center.tasks.length === 0 && <div className="empty-state">進行中タスクはありません。</div>}
            </div>
          </section>

          <section className="panel gate-panel" id="approval">
            <div className="section-heading"><div><p className="section-kicker alert-kicker">HUMAN GATE</p><h2>あなたの判断が必要</h2></div><span className="count-badge">{dashboard.decisions.length}</span></div>
            {dashboard.decisions.length === 0 ? <div className="empty-success"><span>✓</span><div><strong>判断待ちはありません</strong><p>AI社員が自動で作業を継続できます。</p></div></div> : dashboard.decisions.map((item) => <article className="decision-card" key={item.approvalKey}>
              <div className="decision-main"><span className="risk-badge">HIGH</span><div><h3>{item.title}</h3><p>{item.detail}</p><details><summary>詳細を見る</summary><p>理由: {item.reasons.join(" / ") || "詳細理由なし"}</p></details></div></div>
              <div className="decision-actions">{!readiness.ready ? <span>承認機能の設定が必要です</span> : pendingApprovalKey === item.approvalKey ? <div className="approval-grace"><strong>承認を送信しました</strong><p>AI社員の反映待ちです。</p></div> : ownerAuthenticated ? <HumanGateActions approvalKey={item.approvalKey} /> : <form action="/api/owner-login" method="post"><input aria-label="オーナー認証コード" name="passcode" placeholder="初回認証コード" required type="password"/><button className="button secondary" type="submit">この端末を認証</button></form>}</div>
            </article>)}
          </section>

          <section className="panel" id="history">
            <div className="section-heading"><div><p className="section-kicker">HISTORY</p><h2>最近の作業履歴</h2></div></div>
            <div className="history-list">{center.history.slice(0, 8).map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.id}><span className={`history-dot ${item.conclusion === "failure" ? "bad" : item.conclusion === "success" ? "good" : "wait"}`}/><div><strong>{item.title}</strong><small>{fmt(item.createdAt)}</small></div><span>{item.conclusion === "success" ? "完了" : item.conclusion === "failure" ? "失敗" : "実行中"}</span></a>)}</div>
          </section>
        </div>

        <aside className="side-column">
          <section className="panel" id="projects"><div className="section-heading"><div><p className="section-kicker">PROJECTS</p><h2>プロジェクト</h2></div></div><div className="project-list">{center.projects.map((project) => <a href={project.url} target="_blank" rel="noreferrer" key={project.name}><div><strong>{project.name}</strong><small>{project.detail}</small></div><span>{project.status}</span></a>)}</div></section>
          <section className="panel" id="employees"><div className="section-heading"><div><p className="section-kicker">MEMBERS</p><h2>AI社員 在籍一覧</h2></div><span className="count-badge neutral">{employeeRoster.length}</span></div><div className="employee-grid">{employeeRoster.map((name) => <span key={name}>{name}</span>)}</div></section>
          <section className="panel compact-panel"><h2>現在の自律実行</h2><dl><div><dt>状態</dt><dd>{dashboard.status}</dd></div><div><dt>リスク</dt><dd>{dashboard.riskLevel ?? "未判定"}</dd></div><div><dt>次</dt><dd>{dashboard.nextAction ?? "自動処理待ち"}</dd></div></dl></section>
        </aside>
      </section>

      <nav className="mobile-nav" aria-label="スマホメニュー"><a href="#home">ホーム</a><a href="#tasks">タスク</a><a className="operation-nav" href="#operations">操作</a><a href="#approval">承認{dashboard.decisions.length > 0 && <b>{dashboard.decisions.length}</b>}</a><a href="#history">履歴</a></nav>
    </main>
  );
}
