import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function block(sourceText, exportName, nextExportName) {
  const start = sourceText.indexOf(`export const ${exportName} = [`);
  const end = sourceText.indexOf(`export const ${nextExportName}`, start);
  assert.ok(start >= 0 && end > start, `missing ${exportName} block`);
  return sourceText.slice(start, end);
}

test("P5 customization exposes at least 20 independent theme and persona presets", async () => {
  const preferences = await source("src/app/jarvis/ui-preferences.ts");
  const themes = block(preferences, "JARVIS_THEMES", "JARVIS_PERSONAS");
  const personas = block(preferences, "JARVIS_PERSONAS", "JARVIS_VOICES");

  const themeIds = [...themes.matchAll(/\["([a-z0-9-]+)",\s*"[^"]+"\]/g)].map((match) => match[1]);
  const personaIds = [...personas.matchAll(/\["([a-z0-9-]+)",\s*"[^"]+",\s*"[^"]+"\]/g)].map((match) => match[1]);

  assert.ok(themeIds.length >= 20, `expected >=20 themes, got ${themeIds.length}`);
  assert.ok(personaIds.length >= 20, `expected >=20 personas, got ${personaIds.length}`);
  assert.equal(new Set(themeIds).size, themeIds.length, "theme ids must be unique");
  assert.equal(new Set(personaIds).size, personaIds.length, "persona ids must be unique");
});

test("P5 customization persists theme persona voice accent and layout as separate fields", async () => {
  const preferences = await source("src/app/jarvis/ui-preferences.ts");
  const settings = await source("src/app/jarvis/settings/JarvisLocalSettings.tsx");

  for (const field of ["theme", "persona", "voice", "accent", "layout"]) {
    assert.ok(preferences.includes(`${field}: string;`), `missing ${field} preference`);
  }
  assert.ok(preferences.includes('density: "comfortable" | "compact";'));
  assert.ok(preferences.includes('motion: "full" | "reduced";'));

  assert.match(preferences, /normalizeJarvisPreferences/);
  assert.match(preferences, /localStorage\.getItem\(JARVIS_PREFERENCE_KEY\)/);
  assert.match(preferences, /localStorage\.setItem\(JARVIS_PREFERENCE_KEY/);
  assert.match(preferences, /dataset\.jarvisTheme/);
  assert.match(preferences, /dataset\.jarvisPersona/);
  assert.match(preferences, /dataset\.jarvisVoice/);
  assert.match(preferences, /dataset\.jarvisAccent/);
  assert.match(preferences, /dataset\.jarvisLayout/);

  assert.match(settings, /Theme \/ Persona \/ Voice \/ Color \/ Layout/);
  assert.match(settings, /ここでは音声機能の完成を主張しない/);
  assert.doesNotMatch(settings, /fetch\(/);
});

test("every declared theme has a CSS theme selector", async () => {
  const preferences = await source("src/app/jarvis/ui-preferences.ts");
  const css = await source("src/app/jarvis/themes.css");
  const themes = block(preferences, "JARVIS_THEMES", "JARVIS_PERSONAS");
  const themeIds = [...themes.matchAll(/\["([a-z0-9-]+)",\s*"[^"]+"\]/g)].map((match) => match[1]);
  for (const themeId of themeIds) {
    assert.ok(css.includes(`data-jarvis-theme="${themeId}"`), `missing CSS selector for ${themeId}`);
  }
});
