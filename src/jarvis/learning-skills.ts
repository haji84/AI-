import { resolve } from "node:path";
import { PersistentSkillLibrary } from "../gai/skill-library.ts";

const shared = globalThis as typeof globalThis & { __jarvisSkillLibraries?: Map<string, PersistentSkillLibrary> };
export function learningSkills(): PersistentSkillLibrary {
  // Owner-local runtime state is not a deployable source asset.
  const path = resolve(/* turbopackIgnore: true */ process.env.JARVIS_SKILLS_PATH?.trim() || ".jarvis/skills.json");
  const libraries = shared.__jarvisSkillLibraries ??= new Map();
  let library = libraries.get(path);
  if (!library) { library = new PersistentSkillLibrary(path); libraries.set(path, library); }
  return library;
}
