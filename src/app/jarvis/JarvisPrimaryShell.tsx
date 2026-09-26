"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import JarvisCommandSearch from "./JarvisCommandSearch";
import JarvisConnectivityStatus from "./JarvisConnectivityStatus";
import JarvisDisplayModeControls from "./JarvisDisplayModeControls";
import JarvisOperationModeControls from "./JarvisOperationModeControls";
import JarvisPriorityNotifications from "./JarvisPriorityNotifications";
import JarvisReadOnlyBoundary from "./JarvisReadOnlyBoundary";
import GoriqIcon from "./GoriqIcon";
import { applyJarvisAccessibilityPreferences, readJarvisAccessibilityPreferences } from "./accessibility-preferences";
import { applyJarvisDisplayMode, readJarvisDisplayMode } from "./display-modes";
import { applyJarvisOperationMode, readJarvisOperationMode } from "./operation-mode";
import { applyJarvisScreenLayoutProfile, readJarvisScreenLayoutProfiles } from "./screen-layout-profiles";
import { applyJarvisPreferences, readJarvisPreferences } from "./ui-preferences";

const NAV_ITEMS = [
  { href: "/jarvis", label: "ホーム", key: "home" },
  { href: "/jarvis/tasks", label: "作業", key: "tasks" },
  { href: "/jarvis/devices", label: "端末", key: "devices" },
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
        <a className="jarvis-brand" href="/jarvis" aria-label="GORIQ ホーム">
          <span className="jarvis-brand-mark" aria-hidden="true">G</span>
          <span><strong>GORIQ</strong><small>DAILY DRIVER</small></span>
        </a>
        <nav className="jarvis-primary-nav" aria-label="GORIQ メインナビゲーション">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/jarvis"
              ? pathname === "/jarvis"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <a key={item.key} className={active ? "active" : ""} href={item.href} aria-current={active ? "page" : undefined}>
                <GoriqIcon name={item.key} /><span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <details className="jarvis-owner-link">
          <summary className="button secondary">詳細</summary>
          <div>
            <a className="button secondary" href="/jarvis/research">リサーチ</a>
            <a className="button secondary" href={`/jarvis/login?next=${encodeURIComponent(pathname)}`}>オーナー認証</a>
            <JarvisOperationModeControls />
            <JarvisDisplayModeControls />
            <JarvisCommandSearch pathname={pathname} />
          </div>
        </details>
      </header>
      <JarvisConnectivityStatus />
      <JarvisPriorityNotifications />
      <JarvisReadOnlyBoundary>
        <main id="jarvis-main-content" className="jarvis-primary-content" tabIndex={-1}>
          {children}
        </main>
      </JarvisReadOnlyBoundary>
    </div>
  );
}
