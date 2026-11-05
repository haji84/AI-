"use client";

import { useEffect, useState } from "react";
import { isJarvisReadOnlyMode, readJarvisOperationMode } from "../operation-mode";
import type { LocalStateBackupGeneration, LocalStateBackupListing } from "../../../jarvis/local-state-backups";

const ENDPOINT = "/api/jarvis/state-backups";
const messages: Record<string, string> = {
  owner_required: "オーナーとしてログインしてください。",
  fresh_owner_confirmation_required: "信頼済み端末で再ログインして、2分以内に操作してください。",
  private_storage_unsupported: "このOSでは保存領域の保護を確認できません。WindowsのACL保護は未検証のため、この操作は利用できません。",
  unsafe_storage: "保存領域の所有者・保護・リンクを確認できないため停止しました。既存の権限は変更しません。",
  source_unavailable: "設定済みのBrokerまたはCompassデータベースを利用できません。",
  resource_limit: "保存件数・容量または検証回数の上限です。既存の世代は自動削除しません。",
  operation_busy: "別の操作が実行中、または前回の操作ロックが残っています。",
  verification_failed: "整合性の検証に失敗しました。元の状態は変更していません。",
  catalog_invalid: "保存済み世代の情報を確認できないため停止しました。",
  generation_not_found: "指定された世代を確認できません。",
  read_only: "読み取り専用・キオスクでは作成と復元検証を実行できません。",
};
const explain = (code: unknown) => typeof code === "string" && messages[code] || "ローカルバックアップを利用できません。Brokerの接続状態を確認してください。";

export default function JarvisStateBackupSettings() {
  const [listing, setListing] = useState<LocalStateBackupListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(true);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function refresh() {
    const response = await fetch(ENDPOINT, { cache: "no-store", signal: AbortSignal.timeout(40_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(explain(result.code));
    setListing(result);
  }
  useEffect(() => {
    const updateMode = () => setReadOnly(isJarvisReadOnlyMode(readJarvisOperationMode()));
    updateMode();
    window.addEventListener("jarvis-operation-mode-changed", updateMode);
    window.addEventListener("storage", updateMode);
    void refresh().catch(error => setMessage({ kind: "error", text: error instanceof Error && Object.values(messages).includes(error.message) ? error.message : explain(null) })).finally(() => setLoading(false));
    return () => { window.removeEventListener("jarvis-operation-mode-changed", updateMode); window.removeEventListener("storage", updateMode); };
  }, []);

  async function mutate(operation: "create" | "verify", generation?: LocalStateBackupGeneration) {
    const mode = readJarvisOperationMode();
    if (busy || isJarvisReadOnlyMode(mode)) { setMessage({ kind: "error", text: messages.read_only }); return; }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Jarvis-Operation-Mode": mode },
        body: JSON.stringify(operation === "create" ? { operation } : { operation, generationId: generation?.id }), signal: AbortSignal.timeout(40_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(explain(result.code));
      setMessage({ kind: "success", text: operation === "create" ? "ローカル世代を保存しました。" : "隔離した新規コピーへの復元を検証しました。稼働中の状態は変更していません。" });
      await refresh();
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error && Object.values(messages).includes(error.message) ? error.message : explain(null) }); }
    finally { setBusy(false); }
  }
  const disabled = loading || busy || readOnly || !listing?.capability.available;
  return <section className="panel jarvis-settings-card" aria-label="ローカル状態バックアップ">
    <div>
      <p className="eyebrow">LOCAL STATE BACKUP</p>
      <h2>ローカル状態バックアップ</h2>
      <p>端末・タスクの状態とGoal・履歴をサーバー内へ保存します。復元を検証すると、新しい隔離コピーで保存内容の整合性を確認できます。</p>
      <p className="muted">PCの待機中作業・観測データ、設定・認証情報、その他の補助ファイルは対象外です。全体を同一時点へ戻す完全バックアップではありません。</p>
      <p className="muted">稼働中の状態は上書きしません。稼働中の状態へ戻す操作には別の承認が必要です。</p>
      <details><summary>対象範囲と検証情報</summary><p>保存対象は設定済みのBroker・CompassのSQLiteのみです。PCタスク・観測JSONと他のサイドカーは含みません。各DBを個別に保存し、実際の復旧には既存のHuman Gateが適用されます。SHA-256は保存内容の整合性確認であり、復旧の承認を与えるものではありません。</p></details>
    </div>
    <div>
      <button className="button" type="button" disabled={disabled} onClick={() => void mutate("create")}>バックアップを作成</button>{" "}
      <button className="button secondary" type="button" disabled={loading || busy} onClick={() => { setLoading(true); void refresh().catch(() => setMessage({ kind: "error", text: explain(null) })).finally(() => setLoading(false)); }}>一覧を更新</button>
      <p className="muted">変更操作には信頼済み端末での直近2分以内のオーナー確認が必要です。<a href="/jarvis/login">再ログイン</a></p>
      {readOnly && <p className="jarvis-alert">読み取り専用・キオスクでは作成と復元検証を停止します。</p>}
      {loading && <p role="status">保存済み世代を確認中…</p>}
      {listing && !listing.capability.available && <p className="jarvis-alert" role="status">{explain(listing.capability.reason)}</p>}
    </div>
    <div aria-label="保存済み世代">
      {listing?.generations.length === 0 && <p className="muted">保存済み世代はありません。</p>}
      {listing?.generations.map(item => <article key={item.id}>
        <h3>世代 {item.id}</h3>
        <p>作成: {item.createdAt} / {item.status === "verified" ? "復元検証済み" : item.status === "ready" ? "保存済み" : "未完了"}</p>
        {item.verifiedAt && <p>最終検証: {item.verifiedAt}</p>}
        {item.stores.map(store => <details key={store.store}><summary>{store.store === "broker" ? "端末・タスク" : "Goal・履歴"}の検証情報</summary><p className="muted">{store.sizeBytes.toLocaleString()} bytes / {store.pagesTransferred} pages / SHA-256 {store.sha256}</p></details>)}
        <button className="button secondary" type="button" disabled={disabled || item.status === "incomplete"} onClick={() => void mutate("verify", item)}>復元を検証</button>
      </article>)}
    </div>
    {message && <p className={message.kind === "error" ? "jarvis-alert" : undefined} role="status">{message.text}</p>}
    <p className="muted">最大32世代・世代ごとに8回の検証、DBごと64MiB・全保存領域512MiBの上限があります。未完了の保存・検証も上限に含み、既存の世代は自動削除しません。外部送信・ダウンロードは行いません。</p>
  </section>;
}
