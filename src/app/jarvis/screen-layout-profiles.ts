export const JARVIS_SCREEN_LAYOUT_PROFILE_KEY = "jarvis-screen-layout-profiles-v1";

export const JARVIS_PRIMARY_SCREENS = [
  ["home", "ホーム", "/jarvis"],
  ["devices", "デバイス", "/jarvis/devices"],
  ["tasks", "タスク", "/jarvis/tasks"],
  ["research", "リサーチ", "/jarvis/research"],
  ["settings", "設定", "/jarvis/settings"],
] as const;

export const JARVIS_SCREEN_LAYOUT_OPTIONS = [
  ["inherit", "共通設定を使う"],
  ["command", "司令センター"],
  ["balanced", "バランス"],
  ["focus", "フォーカス"],
  ["mobile", "モバイル優先"],
] as const;

export type JarvisPrimaryScreenId = typeof JARVIS_PRIMARY_SCREENS[number][0];
export type JarvisScreenLayoutProfile = typeof JARVIS_SCREEN_LAYOUT_OPTIONS[number][0];
export type JarvisScreenLayoutProfiles = Record<JarvisPrimaryScreenId, JarvisScreenLayoutProfile>;

export const DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES: JarvisScreenLayoutProfiles = {
  home: "inherit",
  devices: "inherit",
  tasks: "inherit",
  research: "inherit",
  settings: "inherit",
};

function isProfile(value: unknown): value is JarvisScreenLayoutProfile {
  return typeof value === "string" && JARVIS_SCREEN_LAYOUT_OPTIONS.some(([id]) => id === value);
}

export function normalizeJarvisScreenLayoutProfiles(value: unknown): JarvisScreenLayoutProfiles {
  const candidate = value && typeof value === "object" ? value as Partial<JarvisScreenLayoutProfiles> : {};
  return Object.fromEntries(
    JARVIS_PRIMARY_SCREENS.map(([screen]) => [screen, isProfile(candidate[screen]) ? candidate[screen] : "inherit"]),
  ) as JarvisScreenLayoutProfiles;
}

export function jarvisScreenIdFromPathname(pathname: string): JarvisPrimaryScreenId | null {
  if (pathname === "/jarvis") return "home";
  for (const [screen, , href] of JARVIS_PRIMARY_SCREENS) {
    if (screen === "home") continue;
    if (pathname === href || pathname.startsWith(`${href}/`)) return screen;
  }
  return null;
}

export function readJarvisScreenLayoutProfiles(): JarvisScreenLayoutProfiles {
  try {
    const raw = window.localStorage.getItem(JARVIS_SCREEN_LAYOUT_PROFILE_KEY);
    return raw ? normalizeJarvisScreenLayoutProfiles(JSON.parse(raw)) : { ...DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES };
  } catch {
    return { ...DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES };
  }
}

export function writeJarvisScreenLayoutProfiles(profiles: JarvisScreenLayoutProfiles) {
  window.localStorage.setItem(JARVIS_SCREEN_LAYOUT_PROFILE_KEY, JSON.stringify(normalizeJarvisScreenLayoutProfiles(profiles)));
}

export function applyJarvisScreenLayoutProfile(pathname: string, profiles = readJarvisScreenLayoutProfiles()) {
  const screen = jarvisScreenIdFromPathname(pathname);
  const profile = screen ? normalizeJarvisScreenLayoutProfiles(profiles)[screen] : "inherit";
  const root = document.documentElement;
  root.dataset.jarvisScreen = screen ?? "other";
  if (profile === "inherit") delete root.dataset.jarvisScreenLayout;
  else root.dataset.jarvisScreenLayout = profile;
  return { screen, profile };
}
