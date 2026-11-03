export const JARVIS_SCREEN_LAYOUT_PROFILE_KEY = "jarvis-screen-layout-profiles-v2";
const LEGACY_KEY = "jarvis-screen-layout-profiles-v1";
const SCREEN_DESIGN_KEY = "jarvis-ui-theme";

export const JARVIS_PRIMARY_SCREENS = [
  ["home", "ホーム", "/jarvis"],
  ["tasks", "プロジェクト", "/jarvis/tasks"],
  ["newDevelopment", "新規開発", "/jarvis/new-development"],
  ["decisions", "判断待ち", "/jarvis/decisions"],
  ["devices", "端末", "/jarvis/devices"],
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
export type JarvisScreenLayoutProfilesByDesign = Record<string, JarvisScreenLayoutProfiles>;

export const DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES: JarvisScreenLayoutProfiles = {
  home: "inherit",
  tasks: "inherit",
  newDevelopment: "inherit",
  decisions: "inherit",
  devices: "inherit",
  research: "inherit",
  settings: "inherit",
};

function isProfile(value: unknown): value is JarvisScreenLayoutProfile {
  return typeof value === "string" && JARVIS_SCREEN_LAYOUT_OPTIONS.some(([id]) => id === value);
}

function selectedDesignId() {
  try {
    return window.localStorage.getItem(SCREEN_DESIGN_KEY)?.trim() || "clean-modern";
  } catch {
    return "clean-modern";
  }
}

export function normalizeJarvisScreenLayoutProfiles(value: unknown): JarvisScreenLayoutProfiles {
  const candidate = value && typeof value === "object" ? value as Partial<JarvisScreenLayoutProfiles> : {};
  return Object.fromEntries(
    JARVIS_PRIMARY_SCREENS.map(([screen]) => [screen, isProfile(candidate[screen]) ? candidate[screen] : "inherit"]),
  ) as JarvisScreenLayoutProfiles;
}

function normalizeByDesign(value: unknown): JarvisScreenLayoutProfilesByDesign {
  if (!value || typeof value !== "object") return {};
  const candidate = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(candidate)
      .filter(([design]) => Boolean(design.trim()))
      .map(([design, profiles]) => [design, normalizeJarvisScreenLayoutProfiles(profiles)]),
  );
}

function readAllProfiles(): JarvisScreenLayoutProfilesByDesign {
  try {
    const raw = window.localStorage.getItem(JARVIS_SCREEN_LAYOUT_PROFILE_KEY);
    if (raw) return normalizeByDesign(JSON.parse(raw));

    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (!legacy) return {};
    const migrated = { [selectedDesignId()]: normalizeJarvisScreenLayoutProfiles(JSON.parse(legacy)) };
    window.localStorage.setItem(JARVIS_SCREEN_LAYOUT_PROFILE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return {};
  }
}

export function jarvisScreenIdFromPathname(pathname: string): JarvisPrimaryScreenId | null {
  if (pathname === "/jarvis") return "home";
  for (const [screen, , href] of JARVIS_PRIMARY_SCREENS) {
    if (screen === "home") continue;
    if (pathname === href || pathname.startsWith(`${href}/`)) return screen;
  }
  return null;
}

export function readJarvisScreenLayoutProfiles(designId = selectedDesignId()): JarvisScreenLayoutProfiles {
  const all = readAllProfiles();
  return all[designId] ? normalizeJarvisScreenLayoutProfiles(all[designId]) : { ...DEFAULT_JARVIS_SCREEN_LAYOUT_PROFILES };
}

export function writeJarvisScreenLayoutProfiles(profiles: JarvisScreenLayoutProfiles, designId = selectedDesignId()) {
  const all = readAllProfiles();
  all[designId] = normalizeJarvisScreenLayoutProfiles(profiles);
  window.localStorage.setItem(JARVIS_SCREEN_LAYOUT_PROFILE_KEY, JSON.stringify(all));
}

export function applyJarvisScreenLayoutProfile(pathname: string, profiles = readJarvisScreenLayoutProfiles()) {
  const screen = jarvisScreenIdFromPathname(pathname);
  const profile = screen ? normalizeJarvisScreenLayoutProfiles(profiles)[screen] : "inherit";
  const root = document.documentElement;
  root.dataset.jarvisScreen = screen ?? "other";
  root.dataset.goriqScreenDesign = selectedDesignId();
  if (profile === "inherit") delete root.dataset.jarvisScreenLayout;
  else root.dataset.jarvisScreenLayout = profile;
  return { screen, profile, designId: selectedDesignId() };
}
