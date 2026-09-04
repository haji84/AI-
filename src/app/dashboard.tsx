"use client";

import { useMemo, useState } from "react";
import type { ProjectState } from "../dashboard/project-state";

type View = "status" | "tasks" | "people" | "manage";

const employees = [
  ["統括責任者", "会社全体の判断", "待機"],
  ["進行管理", "仕事の分解と割り振り", "稼働中"],
  ["調査担当", "根拠と資料の収集", "待機"],
  ["設計担当", "仕組みと構造の設計", "待機"],
  ["基盤担当", "裏側の処理を実装", "稼働中"],
  ["画面担当", "スマホ画面を実装", "稼働中"],
  ["品質検証", "動作と不具合を確認", "稼働中"],
  ["最終審査", "成果物の合否を判断", "待機"],
] as const;

const specialistEmployees = ["市場調査", "営業担当", "経理担当", "法務担当", "広告担当", "動画編集", "連携担当", "データ担当", "安全管理", "運用・復旧", "知識管理"];

function japanesePhase(value: string) {
  return value.replace(/Phase\s*(\d+)/i, "第$1段階");
}

function japaneseStatus(value: string) {
  const dictionary: Record<string, string> = { PHASE_3_REAL_MACHINE_SMOKE_PENDING: "実機での最終確認待ち" };
  return dictionary[value] || value.replaceAll("_", " ");
}

function japaneseEpic(value: string) {
  return value === "Image editing" ? "画像編集" : value;
}

function japaneseBlocker(value: string) {
  return value.includes("Qwen-Image-Edit") ? "画像編集AIを実機で動かした証拠が必要" : value;
}

function japaneseNextAction(value: string) {
  return value.includes("comfyui-qwen-image-edit-smoke")
    ? "実際のパソコンで画像編集テストを行い、結果を作業票 #78へ記録する"
    : value;
}

export default function Dashboard({ project }: { project: ProjectState }) {
  const [view, setView] = useState<View>("status");
  const [detail, setDetail] = useState(false);
  const [notice, setNotice] = useState("");
  const progress = useMemo(() => project.status.includes("PENDING") ? 80 : 100, [project.status]);
  const nav: Array<[View, string, string]> = [["status", "状況", "◎"], ["tasks", "タスク", "✓"], ["people", "社員", "人"], ["manage", "管理", "⚙"]];

  const select = (next: View) => {
    setView(next);
    setNotice(`${nav.find(([key]) => key === next)?.[1]}を表示しました`);
  };

  return (
    <div className="app-shell">
      <aside className="side-nav" aria-label="主な画面">
        <div className="brand-mark" aria-hidden="true">会</div>
        <div className="brand-copy"><strong>AI会社</strong><span>仕事管理</span></div>
        <nav>{nav.map(([key, label, icon]) => <button key={key} className={view === key ? "active" : ""} onClick={() => select(key)} aria-current={view === key ? "page" : undefined}><span className="nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>{key === "tasks" && <b>2</b>}</button>)}</nav>
        <div className="side-foot"><i className="live-dot" />状態管理 実機確認済み</div>
      </aside>

      <div className="content-shell">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">会</span><strong>AI会社</strong></div>
          <div className="view-switch" aria-label="情報量の切り替え"><button className={!detail ? "active" : ""} onClick={() => setDetail(false)}>かんたん</button><button className={detail ? "active" : ""} onClick={() => setDetail(true)}>詳しく</button></div>
          <button className="notice-button" aria-label="対応が必要な項目2件">要対応 <b>2</b></button>
        </header>

        <main>
          {view === "status" && <>
            <div className="page-heading"><div><p className="overline">会社の現在地</p><h1>全体状況</h1><p>止まっている仕事と、次にやることを最初に表示しています。</p></div><span className="source-note">元データ：会社状態ファイル<br />更新日 {project.updated}</span></div>
            <section className="attention-card">
              <div className="attention-top"><div><span className="status-chip"><i />確認が必要</span><h2>{japaneseEpic(project.currentEpic)}を実際に動かす</h2><p>{japanesePhase(project.phase)}・{japaneseStatus(project.status)}</p></div><strong className="big-progress">{progress}<small>%</small></strong></div>
              <div className="progress-track" role="progressbar" aria-label="中心タスクの進み具合" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
              <div className="steps" aria-label="作業工程"><span className="done">依頼整理</span><span className="done">設計</span><span className="done">実装</span><span className="current">実機確認</span><span>最終承認</span></div>
              <div className="next-grid"><div><span className="mini-label">止まっている理由</span><strong className="danger-text">{japaneseBlocker(project.blocker)}</strong></div><div><span className="mini-label">次に行うこと</span><strong className="next-text">{japaneseNextAction(project.nextAction)}</strong></div></div>
            </section>
            <div className="metrics"><article><span>作業中</span><strong>2<small>件</small></strong><em>画像編集・画面作成</em></article><article><span>確認待ち</span><strong>1<small>件</small></strong><em>人の判断が必要</em></article><article><span>担当中の社員</span><strong>4<small>人</small></strong><em>登録済み 23人</em></article><article><span>直近の自動検査</span><strong className="success-value">合格</strong><em>{project.lastCi.replace("CI run", "検査").replace("succeeded for main after PR", "・本流・変更提案").replace("merge", "統合後")}</em></article></div>
            <div className="two-column"><section className="panel"><div className="panel-heading"><div><p className="overline">いま動いている仕事</p><h2>タスク</h2></div><button onClick={() => select("tasks")}>すべて見る</button></div><TaskRows /></section><section className="panel"><div className="panel-heading"><div><p className="overline">現在の担当</p><h2>AI社員</h2></div><button onClick={() => select("people")}>社員を見る</button></div><EmployeeRows /></section></div>
            {detail && <section className="detail-strip"><div><span>現在の段階</span><strong>{japanesePhase(project.phase)}</strong></div><div><span>作業票</span><strong>{project.activeIssues}</strong></div><div><span>状態管理</span><strong>{project.compass.includes("verified PASS") ? "実機確認済み" : project.compass}</strong></div><div><span>案件名</span><strong>{project.project === "Unified AI Creator Studio" ? "統合AI制作スタジオ" : project.project}</strong></div></section>}
          </>}
          {view === "tasks" && <TasksView progress={progress} />}
          {view === "people" && <PeopleView />}
          {view === "manage" && <ManageView project={project} />}
        </main>

        <nav className="bottom-nav" aria-label="スマホ用の画面切り替え">{nav.map(([key, label, icon]) => <button key={key} className={view === key ? "active" : ""} onClick={() => select(key)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
        <p className="sr-only" aria-live="polite">{notice}</p>
      </div>
    </div>
  );
}

function TaskRows() {
  return <div className="rows"><div className="task-row"><i className="row-icon">画</i><div><strong>画像編集の実機確認</strong><span>担当：品質検証</span></div><em className="working">確認中</em></div><div className="task-row"><i className="row-icon">見</i><div><strong>結果の最終確認</strong><span>担当：最終審査</span></div><em className="waiting">待機</em></div><div className="task-row"><i className="row-icon">表</i><div><strong>スマホ画面の実装</strong><span>担当：画面担当</span></div><em className="working">作業中</em></div></div>;
}

function EmployeeRows() {
  return <div className="employee-list">{employees.slice(1, 5).map(([name, work, state]) => <div className="employee-row" key={name}><span className={`avatar ${state === "稼働中" ? "online" : ""}`}>{name.slice(0, 1)}</span><div><strong>{name}</strong><small>{work}</small></div><em>{state}</em></div>)}</div>;
}

function TasksView({ progress }: { progress: number }) {
  const tasks = [["画像編集の実機確認", "品質検証", "確認中", `${progress}%`, "テスト画像を実行"], ["結果の最終確認", "最終審査", "待機", "0%", "実機確認の結果を待つ"], ["スマホ画面の実装", "画面担当", "作業中", "60%", "ホーム画面起動を確認"], ["状態管理との連携", "基盤担当", "完了", "100%", "なし"]];
  return <><div className="page-heading"><div><p className="overline">仕事の確認</p><h1>タスク</h1><p>担当、進み具合、次の行動をまとめて確認できます。</p></div><button className="primary-action" disabled>仕事依頼は接続準備中</button></div><section className="panel task-table"><div className="table-head"><span>タスク</span><span>担当</span><span>状態</span><span>進み具合</span><span>次の行動</span></div>{tasks.map(([name, owner, state, value, next]) => <div className="table-row" key={name}><strong>{name}</strong><span data-label="担当">{owner}</span><span data-label="状態" className={state === "完了" ? "done-text" : state === "待機" ? "waiting" : "working"}>{state}</span><span data-label="進み具合">{value}</span><span data-label="次の行動">{next}</span></div>)}</section></>;
}

function PeopleView() {
  return <><div className="page-heading"><div><p className="overline">役割と担当状況</p><h1>AI社員</h1><p>いま誰が担当し、何を受け持っているか確認できます。</p></div><span className="source-note">登録済み 23人<br />担当中 4人</span></div><section className="people-grid">{employees.map(([name, work, state]) => <article key={name}><div><span className={`avatar large ${state === "稼働中" ? "online" : ""}`}>{name.slice(0, 1)}</span><em className={state === "稼働中" ? "working" : "waiting"}>{state === "稼働中" ? "担当中" : state}</em></div><h2>{name}</h2><p>{work}</p></article>)}</section><section className="panel planned"><div className="panel-heading"><div><p className="overline">専門分野を受け持つ社員</p><h2>登録済みの専門社員</h2></div></div><div>{specialistEmployees.map(name => <span key={name}>{name}</span>)}</div></section></>;
}

function ManageView({ project }: { project: ProjectState }) {
  return <><div className="page-heading"><div><p className="overline">接続と安全確認</p><h1>管理</h1><p>会社を動かす仕組みと、対応が必要な項目を確認できます。</p></div></div><div className="manage-grid"><section className="panel"><div className="panel-heading"><h2>接続状況</h2><span className="ok-chip">正常</span></div><div className="connection-row"><span>作業票・コード管理</span><strong>接続済み</strong></div><div className="connection-row"><span>自動実行</span><strong>接続済み</strong></div><div className="connection-row"><span>状態管理</span><strong>{project.compass.includes("PASS") ? "実機確認済み" : "確認中"}</strong></div><div className="connection-row"><span>画像編集AI</span><strong className="working">確認中</strong></div></section><section className="panel"><div className="panel-heading"><h2>安全確認</h2></div><div className="safety-block"><span>人の承認待ち</span><strong>1件</strong><p>外部への公開前に承認が必要です。</p></div><div className="safety-block"><span>直近のエラー</span><strong>0件</strong><p>隠れたエラーは表示しません。なければゼロです。</p></div></section><section className="panel home-help"><div className="panel-heading"><h2>ホーム画面から開く</h2></div><ol><li>Safariでこの画面を開く</li><li>共有ボタンを押す</li><li>「ホーム画面に追加」を選ぶ</li></ol><p>次回から「AI会社」のアイコンを1回押すだけで開けます。</p></section></div></>;
}
