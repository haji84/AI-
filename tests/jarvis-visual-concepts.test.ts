import assert from "node:assert/strict";
import test from "node:test";
import { VISUAL_CONCEPT_IDS, VISUAL_CONCEPTS, applyVisualConcept, findVisualConcept, visualConceptStyle } from "../src/app/jarvis/visual-concepts.ts";

function luminance(hex: string) {
  const components = hex.slice(1).match(/../g)!.map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return components[0] * .2126 + components[1] * .7152 + components[2] * .0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

test("twenty distinct concepts have complete presentation metadata", () => {
  assert.equal(VISUAL_CONCEPT_IDS.length, 20);
  assert.equal(VISUAL_CONCEPTS.length, 20);
  for (const field of ["id", "label", "geometry"] as const) {
    assert.equal(new Set(VISUAL_CONCEPTS.map((concept) => concept[field])).size, 20, field);
  }
  assert.deepEqual(VISUAL_CONCEPTS.map((concept) => concept.id), [...VISUAL_CONCEPT_IDS]);
  for (const concept of VISUAL_CONCEPTS) {
    assert.ok(concept.description.length > 10);
    assert.ok(["light", "dark"].includes(concept.mode));
    assert.ok(concept.radius >= 8 && concept.radius <= 32);
  }
});

test("each concept keeps content, supporting text and accent controls readable", () => {
  for (const concept of VISUAL_CONCEPTS) {
    for (const color of [concept.background, concept.panel, concept.panelElevated, concept.text, concept.muted, concept.accent, concept.accentText, concept.border]) {
      assert.match(color, /^#[0-9a-f]{6}$/i, concept.id);
    }
    for (const surface of [concept.background, concept.panel, concept.panelElevated]) {
      for (const foreground of [concept.text, concept.muted, concept.accent]) {
        assert.ok(contrast(foreground, surface) >= 4.5, `${concept.id}: ${foreground} on ${surface}`);
      }
    }
    assert.ok(contrast(concept.accentText, concept.accent) >= 4.5, `${concept.id}: accent control`);
  }
});

test("art manifests use only the four fixed local atlases and unique bounded cells", () => {
  const cells = new Set<string>();
  VISUAL_CONCEPTS.forEach((concept, index) => {
    const group = Math.floor(index / 6);
    const cell = index % 6;
    assert.equal(concept.atlas, `/jarvis/concepts/scenes-${String.fromCharCode(97 + group)}.png`);
    assert.equal(concept.grid.columns, 2);
    assert.equal(concept.grid.rows, group === 3 ? 1 : 3);
    assert.equal(concept.grid.column, cell % 2);
    assert.equal(concept.grid.row, Math.floor(cell / 2));
    cells.add(`${concept.atlas}:${concept.grid.column}:${concept.grid.row}`);
    const style = visualConceptStyle(concept);
    assert.equal(style["--personal-art"], `url("${concept.atlas}")`);
    assert.equal(style["--personal-art-size"], group === 3 ? "220% 110%" : "220% 340%");
    assert.equal(style["--personal-art-position"], `${concept.grid.column * 100}% ${concept.grid.rows === 1 ? 0 : concept.grid.row * 50}%`);
    assert.ok(Object.keys(style).every((key) => key.startsWith("--personal-")));
  });
  assert.equal(cells.size, 20);
});

test("unknown input cannot choose arbitrary art or inject CSS", () => {
  for (const input of [null, undefined, "", "../evil", "https://example.com/art.png", "hologram; color:red", {}, 1]) {
    assert.equal(findVisualConcept(input), null);
  }
  for (const id of VISUAL_CONCEPT_IDS) assert.equal(findVisualConcept(id)?.id, id);
  const first = VISUAL_CONCEPTS[0];
  const spoofed = { ...first, atlas: "https://example.com/tracker.png", geometry: "url(https://example.com/tracker.png)", accent: "red; display:none" };
  assert.deepEqual(visualConceptStyle(spoofed), visualConceptStyle(first));
  assert.ok(Object.isFrozen(VISUAL_CONCEPTS));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.grid));
});

test("applying, switching and clearing a concept preserves unrelated preference keys", () => {
  const properties = new Map<string, string>([["--jarvis-accent", "#123456"], ["--other", "keep"]]);
  const dataset: Record<string, string> = { jarvisTheme: "arc", jarvisPersona: "butler", jarvisVoice: "calm", jarvisAccent: "cyan", jarvisDisplayMode: "privacy" };
  const original = { ...dataset };
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset, style: {
    setProperty: (name: string, value: string) => properties.set(name, value),
    removeProperty: (name: string) => properties.delete(name),
  } } } });
  try {
    for (const concept of VISUAL_CONCEPTS) {
      assert.equal(applyVisualConcept(concept.id)?.id, concept.id);
      assert.equal(dataset.jarvisConcept, concept.id);
      assert.equal(properties.get("--personal-art"), `url("${concept.atlas}")`);
      for (const [key, value] of Object.entries(original)) assert.equal(dataset[key], value);
    }
    for (const input of [null, "unknown"]) {
      applyVisualConcept("hologram");
      assert.equal(applyVisualConcept(input), null);
      assert.deepEqual(dataset, original);
      assert.deepEqual([...properties], [["--jarvis-accent", "#123456"], ["--other", "keep"]]);
    }
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("server-side concept resolution needs no DOM or storage", () => {
  assert.equal(applyVisualConcept("clean-modern")?.id, "clean-modern");
  assert.equal(applyVisualConcept(null), null);
});
