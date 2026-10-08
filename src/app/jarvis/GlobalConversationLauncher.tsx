"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import CommandChat from "../CommandChat";

export default function GlobalConversationLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open || enabled !== null) return;
    void fetch("/api/command", { cache: "no-store" })
      .then((response) => setEnabled(response.ok))
      .catch(() => setEnabled(false));
  }, [enabled, open]);

  useEffect(() => {
    const listener = () => setOpen(true);
    window.addEventListener("goriq-open-conversation", listener);
    return () => window.removeEventListener("goriq-open-conversation", listener);
  }, []);

  if (pathname.startsWith("/jarvis/login")) return null;

  return (
    <>
      <button className="goriq-conversation-fab" type="button" onClick={() => setOpen(true)} aria-label="GORIQと会話">
        <span aria-hidden="true">◉</span><span>会話</span>
      </button>
      {open && (
        <div className="goriq-conversation-layer" role="dialog" aria-modal="true" aria-label="GORIQ全体との会話">
          <button className="goriq-conversation-backdrop" type="button" aria-label="会話を閉じる" onClick={() => setOpen(false)} />
          <section className="goriq-conversation-drawer">
            <header>
              <div>
                <strong>GORIQと会話</strong>
                <small>現在画面を優先しつつ、権限内のGORIQ全体を参照</small>
              </div>
              <button className="button secondary" type="button" onClick={() => setOpen(false)}>閉じる</button>
            </header>
            {enabled === null ? (
              <div className="empty-state"><strong>会話を準備中</strong><small>オーナー認証状態を確認しています。</small></div>
            ) : enabled ? (
              <CommandChat enabled contextPath={pathname} compact />
            ) : (
              <div className="empty-state">
                <strong>オーナー認証が必要です</strong>
                <small>認証後は、どの画面からでも同じ会話履歴で質問・相談・操作できます。</small>
                <a className="button" href={`/jarvis/login?next=${encodeURIComponent(pathname)}`}>認証する</a>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
