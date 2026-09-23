"use client";
import GoriqIcon from "./GoriqIcon";
import { usePersonalUi } from "./PersonalizationProvider";


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
  { href: "/jarvis", label: "ホーム", key: "home", hint: "今日のワークスペース" },
  { href: "/jarvis/devices", label: "デバイス", key: "devices", hint: "接続・端末管理" },
  { href: "/jarvis/tasks", label: "タスク", key: "tasks", hint: "進み具合・履歴" },
  { href: "/jarvis/research", label: "リサーチ", key: "research", hint: "調査・エビデンス" },
  { href: "/jarvis/settings", label: "設定", key: "settings", hint: "自分好みに整える" },
] as const;

function applyStoredPreferences() {
  applyJarvisPreferences(readJarvisPreferences());
  applyJarvisAccessibilityPreferences(readJarvisAccessibilityPreferences());
  applyJarvisDisplayMode(readJarvisDisplayMode());
  applyJarvisOperationMode(readJarvisOperationMode());
}

export default function JarvisPrimaryShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile, legacy } = usePersonalUi();
  const navigation = profile.navOrder.map(key => NAV_ITEMS.find(item => item.key === key)!);

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
    <div className="jarvis-primary-shell" data-personal-nav={legacy ? "top" : profile.navPosition}>
      <a className="jarvis-skip-link" href="#jarvis-main-content">メインコンテンツへ移動</a>
      <header className="jarvis-primary-header">
        <a className="jarvis-brand" href="/jarvis" aria-label="GORIQ ホーム">
          <span className="jarvis-brand-mark" aria-hidden="true">G<span className="goriq-brand-orbit" /></span>
          <span><strong>GORIQ</strong><small>ゴリック · YOUR AI WORKSPACE</small></span>
        </a>

        <div className="goriq-header-search"><JarvisCommandSearch pathname={pathname} /></div>
        <div className="goriq-header-actions"><details className="goriq-display-menu"><summary aria-label="表示設定"><GoriqIcon name="settings" /><span>表示</span></summary><div className="goriq-display-popover"><JarvisOperationModeControls /><JarvisDisplayModeControls /><a href="/jarvis/settings#appearance">デザイン・メニューをカスタマイズ →</a></div></details>
        <a className="button secondary jarvis-owner-link" href={`/jarvis/login?next=${encodeURIComponent(pathname)}`}><GoriqIcon name="shield" /><span>オーナー認証</span></a></div>
      </header>
        <nav className="jarvis-primary-nav" aria-label="GORIQ メインナビゲーション">
          <span className="goriq-nav-caption" aria-hidden="true">WORKSPACE</span>
          {navigation.map((item) => {
            const active = item.href === "/jarvis"
              ? pathname === "/jarvis"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <a key={item.key} className={active ? "active" : ""} href={item.href} aria-current={active ? "page" : undefined}>
                <span className="goriq-nav-icon"><GoriqIcon name={item.key} /></span><span className="goriq-nav-copy"><strong>{item.label}</strong><small>{item.hint}</small></span><span className="goriq-nav-marker" aria-hidden="true" />
              </a>
            );
          })}
        </nav>
      <JarvisConnectivityStatus />
      <JarvisPriorityNotifications />
      <JarvisReadOnlyBoundary>
        <main id="jarvis-main-content" className="jarvis-primary-content" tabIndex={-1}>
          {pathname === "/jarvis" && legacy ? <JarvisHomeLayoutEditor /> : null}
          {children}
        </main>
      </JarvisReadOnlyBoundary>
    </div>
  );
}
