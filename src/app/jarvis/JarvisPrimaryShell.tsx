"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import JarvisCommandSearch from "./JarvisCommandSearch";
import JarvisConnectivityStatus from "./JarvisConnectivityStatus";
import JarvisDisplayModeControls from "./JarvisDisplayModeControls";
import JarvisHomeLayoutEditor from "./JarvisHomeLayoutEditor";
import JarvisOperationModeControls from "./JarvisOperationModeControls";
import JarvisPriorityNotifications from "./JarvisPriorityNotifications";
import JarvisReadOnlyBoundary from "./JarvisReadOnlyBoundary";
import { applyJarvisAccessibilityPreferences, readJarvisAccessibilityPreferences } from "./accessibility-preferences";
import { applyJarvisDisplayMode, readJarvisDisplayMode } from "./display-modes";
import { applyJarvisOperationMode, readJarvisOperationMode } from "./operation-mode";
import { applyJarvisScreenLayoutProfile, readJarvisScreenLayoutProfiles } from "./screen-layout-profiles";
import { applyJarvisPreferences, readJarvisPreferences } from "./ui-preferences";

const NAV_ITEMS = [
  { href: "/jarvis", label: "ホーム", key: "home" },
  { href: "/jarvis/devices", label: "デバイス", key: "devices" },
  { href: "/jarvis/tasks", label: "タスク", key: "tasks" },
  { href: "/jarvis/research", label: "リサーチ", key: "research" },
  { href: "/jarvis/settings", label: "設定", key: "settings" },
] as const;

function applyStoredPreferences() {
  applyJarvisPreferences(readJarvisPreferences());
  applyJarvisAccessibilityPreferences(readJarvisAccessibilityPreferences());
  applyJarvisDisplayMode(readJarvisDisplayMode());
  applyJarvisOperationMode(readJarvisOperationMode());
}

export default function JarvisPrimaryShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    applyStoredPreferences();
    const listener = () => applyStoredPreferences();
    window.addEventListener("jarvis-preferences-changed", listener);
    window.addEventListener("jarvis-accessibility-preferences-changed", listener);
    return () => {
      window.removeEventListener("jarvis-preferences-changed", listener);
      window.removeEventListener("jarvis-accessibility-preferences-changed", listener);
    };
  }, []);

  useEffect(() => {
    const apply = () => applyJarvisScreenLayoutProfile(pathname, readJarvisScreenLayoutProfiles());
    apply();
    window.addEventListener("jarvis-screen-layout-profiles-changed", apply);
    return () => window.removeEventListener("jarvis-screen-layout-profiles-changed", apply);
  }, [pathname]);

  if (pathname.startsWith("/jarvis/login")) return children;

  return (
    <div className="jarvis-primary-shell">
      <a className="jarvis-skip-link" href="#jarvis-main-content">メインコンテンツへ移動</a>
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
      <JarvisConnectivityStatus />
      <JarvisOperationModeControls />
      <JarvisDisplayModeControls />
      <JarvisCommandSearch pathname={pathname} />
      <JarvisPriorityNotifications />
      <JarvisReadOnlyBoundary>
        <div id="jarvis-main-content" className="jarvis-primary-content" tabIndex={-1}>
          {pathname === "/jarvis" ? <JarvisHomeLayoutEditor /> : null}
          {children}
        </div>
      </JarvisReadOnlyBoundary>
    </div>
  );
}
