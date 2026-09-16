"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

const NAV_ITEMS = [
  { href: "/jarvis", label: "ホーム", key: "home" },
  { href: "/jarvis/devices", label: "デバイス", key: "devices" },
  { href: "/jarvis/tasks", label: "タスク", key: "tasks" },
  { href: "/jarvis/research", label: "リサーチ", key: "research" },
  { href: "/jarvis/settings", label: "設定", key: "settings" },
] as const;

const PREFERENCE_KEY = "jarvis-ui-preferences-v1";

type StoredPreferences = {
  density?: "comfortable" | "compact";
  motion?: "full" | "reduced";
};

function applyStoredPreferences() {
  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredPreferences;
    document.documentElement.dataset.jarvisDensity = parsed.density === "compact" ? "compact" : "comfortable";
    document.documentElement.dataset.jarvisMotion = parsed.motion === "reduced" ? "reduced" : "full";
  } catch {
    document.documentElement.dataset.jarvisDensity = "comfortable";
    document.documentElement.dataset.jarvisMotion = "full";
  }
}

export default function JarvisPrimaryShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    applyStoredPreferences();
    const listener = () => applyStoredPreferences();
    window.addEventListener("jarvis-preferences-changed", listener);
    return () => window.removeEventListener("jarvis-preferences-changed", listener);
  }, []);

  if (pathname.startsWith("/jarvis/login")) return children;

  return (
    <div className="jarvis-primary-shell">
      <header className="jarvis-primary-header">
        <a className="jarvis-brand" href="/jarvis" aria-label="JARVIS ホーム">
          <span className="jarvis-brand-mark" aria-hidden="true">J</span>
          <span><strong>JARVIS</strong><small>COMMAND CENTER</small></span>
        </a>
        <nav className="jarvis-primary-nav" aria-label="JARVIS メインナビゲーション">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/jarvis"
              ? pathname === "/jarvis"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <a key={item.key} className={active ? "active" : ""} href={item.href} aria-current={active ? "page" : undefined}>
                {item.label}
              </a>
            );
          })}
        </nav>
        <a className="button secondary jarvis-owner-link" href={`/jarvis/login?next=${encodeURIComponent(pathname)}`}>オーナー認証</a>
      </header>
      <div className="jarvis-primary-content">{children}</div>
    </div>
  );
}
