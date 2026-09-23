import assert from "node:assert/strict";
import test from "node:test";
import {
  PERSONAL_CONCEPT_IDS, PERSONAL_UI_STORAGE_KEY,
  defaultPersonalUiState, normalizePersonalUiState, activePersonalUiProfile,
  updatePersonalUiProfile, addPersonalUiProfile, setActivePersonalUiProfile,
  movePersonalUiPanel, addPersonalUiPanel, removePersonalUiPanel,
  readPersonalUiState, writePersonalUiState,
  createPersonalUiHistory, pushPersonalUiHistory, undoPersonalUiHistory, redoPersonalUiHistory,
} from "../src/app/jarvis/personalization-store.ts";

const nav = ["home", "devices", "tasks", "research", "settings"];

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test("new local profiles include the working home panels and all navigation routes", () => {
  const state = defaultPersonalUiState();
  assert.equal(state.version, 1);
  assert.equal(state.profiles.length, 1);
  assert.equal(activePersonalUiProfile(state).id, state.activeProfileId);
  assert.deepEqual(activePersonalUiProfile(state).navOrder, nav);
  assert.deepEqual(activePersonalUiProfile(state).panels.map(panel => panel.kind), ["command", "goal", "summary", "requirements"]);
  assert.equal(activePersonalUiProfile(state).note, "");
  assert.equal(activePersonalUiProfile(state).name, "マイJARVIS");
  assert.equal(activePersonalUiProfile(state).conceptId, "ai-core");
  state.profiles[0].panels.pop();
  assert.equal(defaultPersonalUiState().profiles[0].panels.length, 4);
});

test("all twenty known concepts survive normalization and unknown concepts fall back", () => {
  assert.equal(new Set(PERSONAL_CONCEPT_IDS).size, 20);
  for (const conceptId of PERSONAL_CONCEPT_IDS) {
    const state = defaultPersonalUiState();
    state.profiles[0].conceptId = conceptId;
    assert.equal(normalizePersonalUiState(state).profiles[0].conceptId, conceptId);
  }
  const base = defaultPersonalUiState();
  const bad = { ...base, profiles: [{ ...base.profiles[0], conceptId: "../../evil" }] };
  assert.equal(normalizePersonalUiState(bad).profiles[0].conceptId, "ai-core");
});

test("malformed, stale and future schemas get a safe fresh default", () => {
  for (const value of [null, [], "bad", 7, { version: 0 }, { version: 2, profiles: [] }, { version: 1, profiles: [] }]) {
    assert.deepEqual(normalizePersonalUiState(value), defaultPersonalUiState());
  }
});

test("normalization recovers five fixed routes exactly once and rejects arbitrary links", () => {
  const base = defaultPersonalUiState();
  const normalized = normalizePersonalUiState({ ...base, activeProfileId: "unknown", profiles: [{
    ...base.profiles[0], navPosition: "offscreen", navOrder: ["settings", "settings", "/admin", "javascript:alert(1)", "home"],
  }] });
  assert.equal(normalized.activeProfileId, normalized.profiles[0].id);
  assert.deepEqual(normalized.profiles[0].navOrder, ["settings", "home", "devices", "tasks", "research"]);
  assert.equal(normalized.profiles[0].navPosition, "left");
});

test("normalization bounds profile data, generates safe unique IDs and discards unknown configuration", () => {
  const normalized = normalizePersonalUiState({ version: 1, activeProfileId: "../bad", profiles: Array.from({ length: 30 }, (_, i) => ({
    id: i === 0 ? "../bad" : "same", name: "x".repeat(80), note: "a".repeat(3000), conceptId: "hologram", navOrder: nav,
    panels: Array.from({ length: 40 }, () => ({ id: "__proto__", kind: "note", width: "full", html: "unsafe", url: "https://invalid.test", credentials: "excluded" })),
    credentials: "excluded", html: "unsafe",
  })) });
  assert.equal(normalized.profiles.length, 12);
  assert.equal(new Set(normalized.profiles.map(profile => profile.id)).size, 12);
  for (const profile of normalized.profiles) {
    assert.match(profile.id, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
    assert.equal(profile.name.length, 40);
    assert.equal(profile.note.length, 2000);
    assert.equal(profile.panels.length, 1);
    assert.equal(new Set(profile.panels.map(panel => panel.id)).size, 1);
    assert.ok(profile.panels.every(panel => panel.id !== "__proto__"));
  }
  assert.ok(!JSON.stringify(normalized).includes("excluded"));
  assert.ok(!JSON.stringify(normalized).includes("unsafe"));
});

test("prototype and accessor properties cannot inject profile data or execute during normalization", () => {
  const base = defaultPersonalUiState();
  let accessed = false;
  const evil = { ...base.profiles[0] };
  Object.defineProperty(evil, "note", { enumerable: true, get() { accessed = true; throw new Error("must not run"); } });
  const value = normalizePersonalUiState({ ...base, profiles: [evil] });
  assert.equal(accessed, false);
  assert.equal(value.profiles[0].note, "");
  assert.deepEqual(normalizePersonalUiState(Object.create(base)), defaultPersonalUiState());
  const polluted = JSON.parse('{"version":1,"__proto__":{"polluted":true},"profiles":[{"id":"constructor","name":"Safe","conceptId":"nature","panels":[],"note":"text"}]}');
  const result = normalizePersonalUiState(polluted);
  assert.notEqual(result.profiles[0].id, "constructor");
  assert.equal(Object.hasOwn(result, "__proto__"), false);
  assert.equal(result.profiles[0].note, "text");
});

test("panel normalization accepts an intentionally empty layout and rejects executable panel kinds", () => {
  const base = defaultPersonalUiState();
  const empty = normalizePersonalUiState({ ...base, profiles: [{ ...base.profiles[0], panels: [] }] });
  assert.deepEqual(empty.profiles[0].panels, []);
  const safe = normalizePersonalUiState({ ...base, profiles: [{ ...base.profiles[0], panels: [{ id: "iframe", kind: "iframe", width: "full" }, { id: "clock", kind: "clock", width: "giant" }] }] });
  assert.deepEqual(safe.profiles[0].panels, [{ id: "clock", kind: "clock", width: "normal" }]);
});

test("profile creation copies a layout independently and updates do not mutate the original", () => {
  const initial = defaultPersonalUiState();
  const original = JSON.stringify(initial);
  const created = addPersonalUiProfile(initial, "Research");
  assert.equal(created.error, null);
  assert.equal(created.state.profiles.length, 2);
  const secondId = created.state.activeProfileId;
  const updated = updatePersonalUiProfile(created.state, secondId, { conceptId: "nature", note: "Keep this local", navPosition: "right", navOrder: ["settings", "research", "tasks", "devices", "home"] });
  assert.equal(activePersonalUiProfile(updated).name, "Research");
  assert.equal(updated.profiles[0].note, "");
  assert.equal(updated.profiles[1].note, "Keep this local");
  assert.equal(created.state.profiles[1].conceptId, "ai-core");
  assert.equal(JSON.stringify(initial), original);
  const switched = setActivePersonalUiProfile(updated, initial.activeProfileId);
  assert.equal(activePersonalUiProfile(switched).conceptId, "ai-core");
  assert.equal(setActivePersonalUiProfile(switched, "missing").activeProfileId, initial.activeProfileId);
});

test("profile capacity failure preserves existing profiles and returns a visible error", () => {
  let state = defaultPersonalUiState();
  for (let i = 1; i < 12; i++) state = addPersonalUiProfile(state, `Profile ${i}`).state;
  const before = JSON.stringify(state);
  const result = addPersonalUiProfile(state, "Thirteenth");
  assert.ok(result.error);
  assert.equal(JSON.stringify(result.state), before);
});

test("panels can be added, moved, resized and all removed without changing other profiles", () => {
  let state = addPersonalUiProfile(defaultPersonalUiState(), "Custom").state;
  const profileId = state.activeProfileId;
  const added = addPersonalUiPanel(state, profileId, "clock");
  assert.equal(added.error, null);
  state = added.state;
  const clockId = activePersonalUiProfile(state).panels.at(-1)!.id;
  state = movePersonalUiPanel(state, profileId, clockId, 0);
  assert.equal(activePersonalUiProfile(state).panels[0].kind, "clock");
  assert.equal(state.profiles[0].panels.length, 4);
  state = updatePersonalUiProfile(state, profileId, { panels: activePersonalUiProfile(state).panels.map(panel => panel.id === clockId ? { ...panel, width: "full" } : panel) });
  assert.equal(activePersonalUiProfile(state).panels[0].width, "full");
  const previous = state;
  state = movePersonalUiPanel(state, profileId, clockId, 999);
  assert.equal(activePersonalUiProfile(state).panels.at(-1)!.kind, "clock");
  assert.equal(activePersonalUiProfile(previous).panels[0].kind, "clock");
  for (const panel of activePersonalUiProfile(state).panels) state = removePersonalUiPanel(state, profileId, panel.id);
  assert.deepEqual(activePersonalUiProfile(state).panels, []);
  assert.deepEqual(activePersonalUiProfile(state).navOrder, nav);
});

test("each panel kind occurs once so interactive panels cannot issue duplicate work", () => {
  let state = defaultPersonalUiState();
  for (const kind of ["clock", "note", "shortcuts"] as const) state = addPersonalUiPanel(state, state.activeProfileId, kind).state;
  assert.equal(activePersonalUiProfile(state).panels.length, 7);
  for (const kind of ["command", "goal", "summary", "requirements", "clock", "note", "shortcuts"] as const) {
    const result = addPersonalUiPanel(state, state.activeProfileId, kind);
    assert.ok(result.error);
    assert.deepEqual(result.state, state);
  }
  assert.ok(addPersonalUiPanel(state, "missing", "clock").error);
  const profile = activePersonalUiProfile(state);
  const normalized = normalizePersonalUiState({ ...state, profiles: [{ ...profile, panels: [...profile.panels, { id: "second-command", kind: "command", width: "normal" }] }] });
  assert.equal(activePersonalUiProfile(normalized).panels.length, 7);
  assert.equal(activePersonalUiProfile(normalized).panels.filter(panel => panel.kind === "command").length, 1);
  const hidden = removePersonalUiPanel(state, state.activeProfileId, profile.panels.find(panel => panel.kind === "command")!.id);
  const restored = addPersonalUiPanel(hidden, hidden.activeProfileId, "command");
  assert.equal(restored.error, null);
  assert.equal(activePersonalUiProfile(restored.state).panels.length, 7);
});

test("storage roundtrip preserves independent profiles and leaves earlier preference keys alone", () => {
  const storage = memoryStorage({ "jarvis-ui-preferences-v1": '{"persona":"butler"}' });
  let state = addPersonalUiProfile(defaultPersonalUiState(), "Work").state;
  state = updatePersonalUiProfile(state, state.activeProfileId, { conceptId: "cockpit", note: '<script>alert("literal text")</script>' });
  assert.deepEqual(writePersonalUiState(state, storage), { ok: true, error: null });
  assert.deepEqual(readPersonalUiState(storage), { state, error: null });
  assert.equal(storage.values.get("jarvis-ui-preferences-v1"), '{"persona":"butler"}');
  assert.equal(storage.values.size, 2);
  assert.ok(storage.values.has(PERSONAL_UI_STORAGE_KEY));
});

test("empty storage starts clean while corrupt and inaccessible storage expose recovery errors", () => {
  assert.deepEqual(readPersonalUiState(memoryStorage()), { state: defaultPersonalUiState(), error: null });
  for (const raw of ["{bad", '{"version":9}', '"unexpected"', "x".repeat(300000)]) {
    const result = readPersonalUiState(memoryStorage({ [PERSONAL_UI_STORAGE_KEY]: raw }));
    assert.ok(result.error);
    assert.deepEqual(result.state, defaultPersonalUiState());
  }
  const blocked = { getItem() { throw new Error("read failure"); }, setItem() { throw new Error("quota"); } };
  assert.ok(readPersonalUiState(blocked).error);
  assert.deepEqual(writePersonalUiState(defaultPersonalUiState(), blocked).ok, false);
  assert.ok(writePersonalUiState(defaultPersonalUiState(), blocked).error);
  assert.ok(readPersonalUiState(null).error);
  assert.equal(writePersonalUiState(defaultPersonalUiState(), null).ok, false);
  assert.doesNotThrow(() => readPersonalUiState());
});

test("history restores complete profile changes, truncates redo on a new edit and stays bounded", () => {
  const initial = defaultPersonalUiState();
  let history = createPersonalUiHistory(initial);
  const next = updatePersonalUiProfile(initial, initial.activeProfileId, { conceptId: "nature" });
  history = pushPersonalUiHistory(history, next);
  assert.equal(undoPersonalUiHistory(history).present.profiles[0].conceptId, "ai-core");
  history = undoPersonalUiHistory(history);
  assert.equal(redoPersonalUiHistory(history).present.profiles[0].conceptId, "nature");
  history = pushPersonalUiHistory(history, addPersonalUiProfile(history.present, "Separate").state);
  assert.equal(history.future.length, 0);
  for (let i = 0; i < 45; i++) history = pushPersonalUiHistory(history, updatePersonalUiProfile(history.present, history.present.activeProfileId, { note: String(i) }));
  assert.equal(history.past.length, 30);
  const unchanged = pushPersonalUiHistory(history, history.present);
  assert.equal(unchanged.past.length, history.past.length);
  assert.deepEqual(undoPersonalUiHistory(createPersonalUiHistory(initial)).present, initial);
  assert.deepEqual(redoPersonalUiHistory(createPersonalUiHistory(initial)).present, initial);
});



test("repairing an earlier profile cannot take the selected valid profile ID", () => {
  const normalized = normalizePersonalUiState({ version: 1, activeProfileId: "profile-1", profiles: [
    { id: "../invalid", name: "Damaged", conceptId: "nature", panels: [], note: "wrong" },
    { id: "profile-1", name: "Original", conceptId: "ai-core", panels: [], note: "owner note" },
    { id: "profile-1", name: "Duplicate", conceptId: "cockpit", panels: [], note: "separate" },
  ] });
  assert.equal(normalized.profiles[1].id, "profile-1");
  assert.equal(activePersonalUiProfile(normalized).name, "Original");
  assert.equal(activePersonalUiProfile(normalized).note, "owner note");
  assert.equal(new Set(normalized.profiles.map(profile => profile.id)).size, 3);
  assert.deepEqual(normalizePersonalUiState(normalized), normalized);
});

test("panel ID repair preserves later valid IDs and remains stable after reload", () => {
  const base = defaultPersonalUiState();
  const normalized = normalizePersonalUiState({ ...base, profiles: [{ ...base.profiles[0], panels: [
    { id: "../invalid", kind: "command", width: "full" },
    { id: "panel-1", kind: "goal", width: "wide" },
    { id: "panel-1", kind: "summary", width: "normal" },
  ] }] });
  assert.equal(normalized.profiles[0].panels[1].id, "panel-1");
  assert.equal(new Set(normalized.profiles[0].panels.map(panel => panel.id)).size, 3);
  const storage = memoryStorage();
  assert.equal(writePersonalUiState(normalized, storage).ok, true);
  assert.deepEqual(readPersonalUiState(storage), { state: normalized, error: null });
});
