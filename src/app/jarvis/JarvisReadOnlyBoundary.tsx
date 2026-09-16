"use client";

import type { FormEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  isJarvisReadOnlyMode,
  isSafeJarvisReadOnlyHref,
  readJarvisOperationMode,
  type JarvisOperationMode,
} from "./operation-mode";

function elementFromTarget(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function shouldBlockClick(target: Element | null) {
  if (!target) return false;
  const anchor = target.closest("a[href]");
  if (anchor) return !isSafeJarvisReadOnlyHref(anchor.getAttribute("href") ?? "");
  return Boolean(target.closest("button,input,select,textarea,[role='button'],[contenteditable='true']"));
}

export default function JarvisReadOnlyBoundary({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<JarvisOperationMode>("standard");

  useEffect(() => {
    setMode(readJarvisOperationMode());
    const listener = () => setMode(readJarvisOperationMode());
    window.addEventListener("jarvis-operation-mode-changed", listener);
    return () => window.removeEventListener("jarvis-operation-mode-changed", listener);
  }, []);

  const readOnly = isJarvisReadOnlyMode(mode);

  function blockClick(event: MouseEvent<HTMLDivElement>) {
    if (!readOnly || !shouldBlockClick(elementFromTarget(event.target))) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function blockSubmit(event: FormEvent<HTMLDivElement>) {
    if (!readOnly) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function blockRemotePointer(event: PointerEvent<HTMLDivElement>) {
    if (!readOnly) return;
    const target = elementFromTarget(event.target);
    if (!target?.closest(".jarvis-remote-screen,.jarvis-multiview-shot")) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function blockEditingKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!readOnly || event.key === "Tab" || event.key === "Escape") return;
    const target = elementFromTarget(event.target);
    if (!target?.closest("input,select,textarea,[contenteditable='true']")) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      className="jarvis-operation-boundary"
      data-jarvis-read-only={readOnly ? "true" : "false"}
      onClickCapture={blockClick}
      onSubmitCapture={blockSubmit}
      onPointerDownCapture={blockRemotePointer}
      onKeyDownCapture={blockEditingKeys}
    >
      {readOnly ? (
        <div className="jarvis-readonly-banner" role="status">
          <strong>{mode === "kiosk" ? "キオスク" : "読み取り専用"}</strong>
          <span>状態確認のみ。変更操作・遠隔入力・外部アクションは停止中です。</span>
        </div>
      ) : null}
      {children}
    </div>
  );
}
