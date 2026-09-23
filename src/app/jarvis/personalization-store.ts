/** Browser-local presentation data only. Never put identity, credentials or executable widgets here. */
export const PERSONAL_UI_STORAGE_KEY = "jarvis-personal-ui-v1";
export const MAX_PERSONAL_PROFILES = 12;
export const MAX_PERSONAL_PANELS = 20;
export const MAX_PERSONAL_HISTORY = 30;
const MAX_STORAGE_LENGTH = 200_000;

export const PERSONAL_CONCEPT_IDS = [
  "clean-modern", "dark-cinema", "anime-assistant", "portrait-assistant", "portrait-partner",
  "anime-partner", "hologram", "ai-core", "butler", "team", "future-lab", "space-bridge",
  "cockpit", "ar-space", "cyber-city", "nature", "black-gold", "silver-lab", "digital-twin", "adaptive",
] as const;
export const PERSONAL_NAV_IDS = ["home", "devices", "tasks", "research", "settings"] as const;
export const PERSONAL_PANEL_KINDS = ["command", "goal", "summary", "requirements", "clock", "note", "shortcuts"] as const;
export type PersonalConceptId = typeof PERSONAL_CONCEPT_IDS[number];
export type PersonalNavId = typeof PERSONAL_NAV_IDS[number];
export type PersonalNavPosition = "top" | "bottom" | "left" | "right";
export type PersonalPanelKind = typeof PERSONAL_PANEL_KINDS[number];
export type PersonalPanelWidth = "normal" | "wide" | "full";
export type PersonalUiPanel = { id: string; kind: PersonalPanelKind; width: PersonalPanelWidth };
export type PersonalUiProfile = {
  id: string;
  name: string;
  conceptId: PersonalConceptId;
  navPosition: PersonalNavPosition;
  navOrder: PersonalNavId[];
  panels: PersonalUiPanel[];
  /** Plain text only; render as a text node, never as HTML. */
  note: string;
};
export type PersonalUiState = { version: 1; activeProfileId: string; profiles: PersonalUiProfile[] };
export type PersonalUiResult = { state: PersonalUiState; error: string | null };
export type PersonalUiStorage = Pick<Storage, "getItem" | "setItem">;
export type PersonalUiHistory = { past: PersonalUiState[]; present: PersonalUiState; future: PersonalUiState[] };

function plainRecord(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  } catch { return false; }
}

// Data descriptors only: inherited properties and getters never become configuration.
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function entries(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value)) return [];
  const length = own(value, "length");
  if (typeof length !== "number") return [];
  return Array.from({ length: Math.min(length, limit) }, (_, index) => own(value, String(index)));
}

function member<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function boundedText(value: unknown, limit: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  // Preserve newline/tab in notes while dropping non-display control characters.
  return Array.from(value.slice(0, limit)).filter(character => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join("");
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)
    && !["__proto__", "prototype", "constructor"].includes(value);
}

function uniqueId(candidate: unknown, prefix: string, used: Set<string>, reserved: ReadonlySet<string> = used): string {
  if (safeId(candidate) && !used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let index = 1;
  while (used.has(`${prefix}-${index}`) || reserved.has(`${prefix}-${index}`)) index++;
  const id = `${prefix}-${index}`;
  used.add(id);
  return id;
}

function defaultPanels(): PersonalUiPanel[] {
  return [
    { id: "panel-command", kind: "command", width: "full" },
    { id: "panel-goal", kind: "goal", width: "wide" },
    { id: "panel-summary", kind: "summary", width: "normal" },
    { id: "panel-requirements", kind: "requirements", width: "full" },
  ];
}

function defaultProfile(): PersonalUiProfile {
  return { id: "profile-1", name: "マイJARVIS", conceptId: "ai-core", navPosition: "left", navOrder: [...PERSONAL_NAV_IDS], panels: defaultPanels(), note: "" };
}

export function defaultPersonalUiState(): PersonalUiState {
  const profile = defaultProfile();
  return { version: 1, activeProfileId: profile.id, profiles: [profile] };
}

function normalizeNav(value: unknown): PersonalNavId[] {
  const selected = entries(value, 50).filter((item): item is PersonalNavId => typeof item === "string" && PERSONAL_NAV_IDS.includes(item as PersonalNavId));
  return [...new Set([...selected, ...PERSONAL_NAV_IDS])];
}

function normalizePanels(value: unknown): PersonalUiPanel[] {
  if (!Array.isArray(value)) return defaultPanels();
  const used = new Set<string>();
  const panels: PersonalUiPanel[] = [];
  const candidates = entries(value, MAX_PERSONAL_PANELS);
  const reserved = new Set(candidates.filter(plainRecord).map(candidate => own(candidate, "id")).filter(safeId));
  for (const candidate of candidates) {
    if (!plainRecord(candidate)) continue;
    const kind = own(candidate, "kind");
    if (typeof kind !== "string" || !PERSONAL_PANEL_KINDS.includes(kind as PersonalPanelKind)) continue;
    if (panels.some(panel => panel.kind === kind)) continue;
    panels.push({
      id: uniqueId(own(candidate, "id"), "panel", used, reserved), kind: kind as PersonalPanelKind,
      width: member(["normal", "wide", "full"], own(candidate, "width"), "normal"),
    });
  }
  return panels;
}

export function normalizePersonalUiState(value: unknown): PersonalUiState {
  if (!plainRecord(value) || own(value, "version") !== 1) return defaultPersonalUiState();
  const used = new Set<string>();
  const profiles: PersonalUiProfile[] = [];
  const candidates = entries(own(value, "profiles"), MAX_PERSONAL_PROFILES).filter(plainRecord);
  // Reserve existing IDs before repairing earlier entries, preserving active-profile identity.
  const reserved = new Set(candidates.map(candidate => own(candidate, "id")).filter(safeId));
  for (const candidate of candidates) {
    if (!plainRecord(candidate)) continue;
    profiles.push({
      id: uniqueId(own(candidate, "id"), "profile", used, reserved),
      name: boundedText(own(candidate, "name"), 40).trim() || "マイJARVIS",
      conceptId: member(PERSONAL_CONCEPT_IDS, own(candidate, "conceptId"), "ai-core"),
      navPosition: member(["top", "bottom", "left", "right"], own(candidate, "navPosition"), "left"),
      navOrder: normalizeNav(own(candidate, "navOrder")),
      panels: normalizePanels(own(candidate, "panels")),
      note: boundedText(own(candidate, "note"), 2000),
    });
  }
  if (!profiles.length) return defaultPersonalUiState();
  const active = own(value, "activeProfileId");
  return { version: 1, activeProfileId: typeof active === "string" && reserved.has(active) && used.has(active) ? active : profiles[0].id, profiles };
}

export function activePersonalUiProfile(state: PersonalUiState): PersonalUiProfile {
  return state.profiles.find(profile => profile.id === state.activeProfileId) ?? state.profiles[0] ?? defaultProfile();
}

export function updatePersonalUiProfile(state: PersonalUiState, profileId: string, patch: Partial<Omit<PersonalUiProfile, "id">>): PersonalUiState {
  const fields = ["name", "conceptId", "navPosition", "navOrder", "panels", "note"] as const;
  const safePatch: Record<string, unknown> = {};
  for (const field of fields) {
    const value = own(patch, field);
    if (value !== undefined) safePatch[field] = value;
  }
  return normalizePersonalUiState({ ...state, profiles: state.profiles.map(profile => profile.id === profileId ? { ...profile, ...safePatch } : profile) });
}

/** Starts with a copy of the current layout; later edits belong only to the new profile. */
export function addPersonalUiProfile(state: PersonalUiState, name: string): PersonalUiResult {
  if (state.profiles.length >= MAX_PERSONAL_PROFILES) return { state, error: "表示プロフィールは12件までです。" };
  const id = uniqueId(undefined, "profile", new Set(state.profiles.map(profile => profile.id)));
  const profile = { ...activePersonalUiProfile(state), id, name };
  return { state: normalizePersonalUiState({ ...state, activeProfileId: id, profiles: [...state.profiles, profile] }), error: null };
}

export function setActivePersonalUiProfile(state: PersonalUiState, profileId: string): PersonalUiState {
  if (!state.profiles.some(profile => profile.id === profileId)) return state;
  return { ...state, activeProfileId: profileId };
}

export function movePersonalUiPanel(state: PersonalUiState, profileId: string, panelId: string, targetIndex: number): PersonalUiState {
  const profile = state.profiles.find(item => item.id === profileId);
  const sourceIndex = profile?.panels.findIndex(panel => panel.id === panelId) ?? -1;
  if (!profile || sourceIndex < 0 || !Number.isFinite(targetIndex)) return state;
  const panels = [...profile.panels];
  const [panel] = panels.splice(sourceIndex, 1);
  panels.splice(Math.max(0, Math.min(Math.trunc(targetIndex), panels.length)), 0, panel);
  return updatePersonalUiProfile(state, profileId, { panels });
}

export function addPersonalUiPanel(state: PersonalUiState, profileId: string, kind: PersonalPanelKind): PersonalUiResult {
  const profile = state.profiles.find(item => item.id === profileId);
  if (!profile) return { state, error: "表示プロフィールが見つかりません。" };
  if (!PERSONAL_PANEL_KINDS.includes(kind)) return { state, error: "このパネルは追加できません。" };
  if (profile.panels.some(panel => panel.kind === kind)) return { state, error: "このパネルはすでに表示されています。" };
  if (profile.panels.length >= MAX_PERSONAL_PANELS) return { state, error: "パネルは20件までです。" };
  const panel: PersonalUiPanel = { id: uniqueId(undefined, "panel", new Set(profile.panels.map(item => item.id))), kind, width: "normal" };
  return { state: updatePersonalUiProfile(state, profileId, { panels: [...profile.panels, panel] }), error: null };
}

export function removePersonalUiPanel(state: PersonalUiState, profileId: string, panelId: string): PersonalUiState {
  const profile = state.profiles.find(item => item.id === profileId);
  return profile ? updatePersonalUiProfile(state, profileId, { panels: profile.panels.filter(panel => panel.id !== panelId) }) : state;
}

function browserStorage(storage: PersonalUiStorage | null | undefined): PersonalUiStorage | null {
  if (storage !== undefined) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readPersonalUiState(storage?: PersonalUiStorage | null): PersonalUiResult {
  try {
    const target = browserStorage(storage);
    if (!target) return { state: defaultPersonalUiState(), error: "この環境では表示設定を保存できません。" };
    const raw = target.getItem(PERSONAL_UI_STORAGE_KEY);
    if (raw === null) return { state: defaultPersonalUiState(), error: null };
    if (raw.length > MAX_STORAGE_LENGTH) return { state: defaultPersonalUiState(), error: "保存された表示設定が大きすぎます。初期設定を使用します。" };
    const parsed: unknown = JSON.parse(raw);
    const state = normalizePersonalUiState(parsed);
    const repaired = JSON.stringify(parsed) !== JSON.stringify(state);
    return { state, error: repaired ? "保存された表示設定に対応できない内容があり、安全な設定に復元しました。" : null };
  } catch {
    return { state: defaultPersonalUiState(), error: "表示設定を読み込めませんでした。初期設定を使用します。" };
  }
}

export function writePersonalUiState(state: PersonalUiState, storage?: PersonalUiStorage | null): { ok: boolean; error: string | null } {
  try {
    const target = browserStorage(storage);
    if (!target) return { ok: false, error: "この環境では表示設定を保存できません。" };
    target.setItem(PERSONAL_UI_STORAGE_KEY, JSON.stringify(normalizePersonalUiState(state)));
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "表示設定を保存できませんでした。保存領域やブラウザーの設定を確認してください。" };
  }
}

export function createPersonalUiHistory(state: PersonalUiState): PersonalUiHistory {
  return { past: [], present: normalizePersonalUiState(state), future: [] };
}

export function pushPersonalUiHistory(history: PersonalUiHistory, state: PersonalUiState): PersonalUiHistory {
  const present = normalizePersonalUiState(state);
  if (JSON.stringify(present) === JSON.stringify(history.present)) return history;
  return { past: [...history.past, history.present].slice(-MAX_PERSONAL_HISTORY), present, future: [] };
}

export function undoPersonalUiHistory(history: PersonalUiHistory): PersonalUiHistory {
  const present = history.past.at(-1);
  if (!present) return history;
  return { past: history.past.slice(0, -1), present, future: [history.present, ...history.future].slice(0, MAX_PERSONAL_HISTORY) };
}

export function redoPersonalUiHistory(history: PersonalUiHistory): PersonalUiHistory {
  const present = history.future[0];
  if (!present) return history;
  return { past: [...history.past, history.present].slice(-MAX_PERSONAL_HISTORY), present, future: history.future.slice(1) };
}
