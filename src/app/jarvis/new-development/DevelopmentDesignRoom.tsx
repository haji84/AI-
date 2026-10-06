"use client";

import { useEffect, useMemo, useState } from "react";
import CommandChat from "../../CommandChat";

type Status = "undecided" | "tentative" | "confirmed";
type ItemKey = "goal" | "spec" | "design" | "technology" | "done";
type Item = { key: ItemKey; label: string; text: string; status: Status };
type BoardState = { version: 1; projectName: string; items: Item[] };

const STORAGE_KEY = "goriq-new-development-board-v1";
const DEFAULT_ITEMS: Item[] = [
  { key: "goal", label: "Goal", text: "", status: "undecided" },
  { key: "spec", label: "仕様", text: "", status: "undecided" },
  { key: "design", label: "設計", text: "", status: "undecided" },
  { key: "technology", label: "技術", text: "", status: "undecided" },
  { key: "done", label: "完了条件", text: "", status: "undecided" },
];

function normalize(value: unknown): BoardState {
  const candidate = value && typeof value === "object" ? value as Partial<BoardState> : {};
  const source = Array.isArray(candidate.items) ? candidate.items : [];
  return {
    version: 1,
    projectName: typeof candidate.projectName === "string" ? candidate.projectName.slice(0, 80) : "",
    items: DEFAULT_ITEMS.map((fallback) => {
      const found = source.find((item) => item && typeof item === "object" && (item as Partial<Item>).key === fallback.key) as Partial<Item> | undefined;
      const status: Status = found?.status === "confirmed" || found?.status === "tentative" ? found.status : "undecided";
      return { ...fallback, text: typeof found?.text === "string" ? found.text.slice(0, 3000) : "", status };
    }),
  };
}

export default function DevelopmentDesignRoom({ enabled }: { enabled: boolean }) {
  const [board, setBoard] = useState<BoardState>(() => normalize(null));
  const [message, setMessage] = useState("会話しながら右側の設計ボードを更新できます。");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setBoard(normalize(JSON.parse(raw)));
    } catch {}
    setReady(true);
  }, []);

  function save(next: BoardState) {
    const normalized = normalize(next);
    setBoard(normalized);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch {}
  }

  function updateItem(key: ItemKey, patch: Partial<Item>) {
    save({ ...board, items: board.items.map((item) => item.key === key ? { ...item, ...patch } : item) });
  }

  const allConfirmed = useMemo(
    () => board.items.every((item) => item.status === "confirmed" && item.text.trim().length > 0),
    [board.items],
  );

  function startDevelopment() {
    if (!allConfirmed) {
      setMessage("Goal・仕様・設計・技術・完了条件を全部「確定」にしてから開始してください。");
      return;
    }
    const summary = [
      "新規開発を開始してください。",
      board.projectName.trim() ? `Project: ${board.projectName.trim()}` : "",
      ...board.items.map((item) => `${item.label}: ${item.text.trim()}`),
      "上記を最終確定内容として既存Goal Controllerへ渡し、既存Human Gateを維持したまま自律開発を開始してください。",
    ].filter(Boolean).join("\n");
    window.dispatchEvent(new CustomEvent("goriq-command-submit", { detail: { text: summary, source: "text" } }));
    setMessage("最終確定内容を同じ会話へ送信しました。以降はGoal/Taskの進捗として追跡します。");
  }

  return (
    <div className="goriq-development-room" aria-busy={!ready}>
      <section className="goriq-development-chat">
        <CommandChat enabled={enabled} contextPath="/jarvis/new-development" />
      </section>
      <aside className="goriq-development-board" aria-label="現在の仕様と設計">
        <div className="goriq-development-board-heading">
          <div><p className="eyebrow">DESIGN BOARD</p><h2>現在の仕様・設計</h2></div>
          <button className="button secondary" type="button" onClick={() => save({ version: 1, projectName: "", items: DEFAULT_ITEMS })}>初期化</button>
        </div>
        <label className="goriq-development-project-name">プロジェクト名
          <input value={board.projectName} maxLength={80} onChange={(event) => save({ ...board, projectName: event.target.value })} placeholder="任意" />
        </label>
        <div className="goriq-development-items">
          {board.items.map((item) => (
            <article className={`goriq-development-item ${item.status}`} key={item.key}>
              <header><strong>{item.label}</strong><span>{item.status === "confirmed" ? "確定" : item.status === "tentative" ? "仮決め" : "未決定"}</span></header>
              <textarea value={item.text} rows={4} onChange={(event) => updateItem(item.key, { text: event.target.value })} placeholder={`${item.label}を会話で決めたらここへ整理`} />
              <div className="jarvis-button-row">
                <button className="button secondary" type="button" onClick={() => updateItem(item.key, { status: "undecided" })}>未決定</button>
                <button className="button secondary" type="button" onClick={() => updateItem(item.key, { status: "tentative" })}>仮決め</button>
                <button className="button" type="button" disabled={!item.text.trim()} onClick={() => updateItem(item.key, { status: "confirmed" })}>確定</button>
              </div>
            </article>
          ))}
        </div>
        <button className="button goriq-development-start" type="button" disabled={!enabled || !allConfirmed} onClick={startDevelopment}>
          仕様・設計を確定して開発開始
        </button>
        <p className="control-message" role="status">{message}</p>
        <p className="jarvis-boundary-note">確定操作はGoal/仕様の意図を整理するためのものです。権限、課金、秘密情報、破壊的操作、Human Gateを自動承認しません。</p>
      </aside>
    </div>
  );
}
