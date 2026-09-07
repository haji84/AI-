"use client";

import { useEffect, useRef, useState } from "react";

interface ApprovalControlsProps {
  approvalKey: string;
}

const UNDO_SECONDS = 5;

export default function ApprovalControls({ approvalKey }: ApprovalControlsProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (secondsLeft === null || submitting) return;
    if (secondsLeft <= 0) {
      setSubmitting(true);
      formRef.current?.requestSubmit();
      return;
    }

    const timer = window.setTimeout(() => {
      setSecondsLeft((value) => value === null ? null : value - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft, submitting]);

  if (secondsLeft !== null && !submitting) {
    return (
      <div className="approval-grace" role="status" aria-live="polite">
        <div>
          <strong>承認します</strong>
          <p className="muted">{secondsLeft}秒後にAI社員を再開します。間違いなら今すぐ取り消せます。</p>
        </div>
        <button className="button secondary" type="button" onClick={() => setSecondsLeft(null)}>
          取り消す
        </button>
        <form ref={formRef} action="/api/approve" method="post">
          <input name="approvalKey" type="hidden" value={approvalKey} />
        </form>
      </div>
    );
  }

  if (submitting) {
    return <button className="button primary" type="button" disabled>承認処理中…</button>;
  }

  return (
    <button className="button primary" type="button" onClick={() => setSecondsLeft(UNDO_SECONDS)}>
      承認する
    </button>
  );
}
