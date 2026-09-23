"use client";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import GoriqIcon from "./GoriqIcon";
/** A direct menu entry reveals the existing protected console; it never starts a session. */
export default function RemoteConsoleDisclosure({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash !== "#remote-controls" || !ref.current) return;
      ref.current.open = true;
      ref.current.scrollIntoView({ block: "start" });
    };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  return <details ref={ref} id="remote-controls" className="goriq-remote-console"><summary><GoriqIcon name="devices" /><span><strong>遠隔操作コンソール</strong><small>端末を選んで、画面を見る・操作する</small></span><GoriqIcon name="arrow" /></summary>{children}</details>;
}
