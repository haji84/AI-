import { encodeXlsx } from "../orchestrator/local-spreadsheet-capability.ts";
import { encodeDocx } from "../orchestrator/local-document-capability.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, realpath, open, link, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Goal } from "../orchestrator/goal-loop.ts";
import { CognitiveLocalOutcomeCatalog, validateCognitiveMaterial, boundedRead, containedFile, type CognitiveLocalOutcomeManifest } from "./cognitive-local-outcomes.ts";
import { cognitiveDigest, type CognitivePartition } from "./cognitive-state.ts";

export const MATERIAL_REQUEST_BYTES = 300_000;
type Format = CognitiveLocalOutcomeManifest["materials"][number]["format"];
interface MaterialInput { format: Format; content: string; criteria: string[] }
interface IntakeInput { goalId: string; goalDigest: string; materials: MaterialInput[]; mappingAcknowledged: true }
interface Receipt { version: 1; goalId: string; goalDigest: string; rootDigest: string; requestDigest: string; manifest: CognitiveLocalOutcomeManifest }
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const formats = { text: { domain: "file", extension: "txt", type: "text/plain; charset=utf-8" }, "workbook-json": { domain: "spreadsheet", extension: "xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, "document-json": { domain: "document", extension: "docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } } as const;
function shape(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(k => !keys.includes(k))) throw Error("Invalid material intake fields");
}
export function validateMaterialIntake(value: unknown): IntakeInput {
  shape(value, ["goalId", "goalDigest", "materials", "mappingAcknowledged"]);
  if (typeof value.goalId !== "string" || !/^goal-[a-f0-9]{16}$/.test(value.goalId) || typeof value.goalDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.goalDigest) || value.mappingAcknowledged !== true || !Array.isArray(value.materials) || !value.materials.length || value.materials.length > 8) throw Error("Invalid material Goal or mapping acknowledgement");
  let total = 0;
  const materials = value.materials.map(raw => {
    shape(raw, ["format", "content", "criteria"]);
    if (typeof raw.format !== "string" || !Object.hasOwn(formats, raw.format) || typeof raw.content !== "string" || !Array.isArray(raw.criteria) || !raw.criteria.length || raw.criteria.length > 24 || raw.criteria.some(c => typeof c !== "string" || !/^criterion-[1-9][0-9]*$/.test(c)) || new Set(raw.criteria).size !== raw.criteria.length) throw Error("Invalid material format or criteria");
    const format = raw.format as Format; validateCognitiveMaterial(raw.content, format);
    total += Buffer.byteLength(raw.content); if (total > 131_072) throw Error("Material batch exceeds bound");
    return { format, content: raw.content, criteria: [...raw.criteria] as string[] };
  });
  return { goalId: value.goalId, goalDigest: value.goalDigest, materials, mappingAcknowledged: true };
}
async function directory(parent: string, names: string[]) {
  let path = parent;
  if ((await lstat(path)).isSymbolicLink() || !(await lstat(path)).isDirectory()) throw Error("Unsafe material root");
  for (const name of names) {
    path = join(path, name); await mkdir(path).catch(e => { if (e.code !== "EEXIST") throw e; });
    const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Unsafe material directory");
  }
  return path;
}
/** No-replace publication. A crash leaves retryable staged content, never a partial receipt. */
async function publish(path: string, bytes: Buffer) {
  try { if (!(await boundedRead(path, Math.max(bytes.length, 65_536))).equals(bytes)) throw Error("Material publication conflict"); return; }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const temp = path + "." + randomUUID() + ".tmp";
  const h = await open(temp, "wx", 0o600);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  try { await link(temp, path); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST" || !(await boundedRead(path, 65_536)).equals(bytes)) throw Error("Material publication conflict"); }
  finally { await unlink(temp); }
}

/** Owner-bound local data. Call prepare under the same lease as Goal execution. */
export class CognitiveMaterialIntake {
  private readonly stateRoot: string; private readonly dataRoot: string; private readonly partition: CognitivePartition;
  constructor(stateRoot: string, dataRoot: string, partition: CognitivePartition) {
    this.stateRoot = resolve(stateRoot); this.dataRoot = resolve(dataRoot); this.partition = partition;
  }
  private key(goalId: string) { return cognitiveDigest({ goalId, partition: this.partition }); }
  private async roots() {
    const info = await lstat(this.dataRoot); if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Unsafe material data root");
    await mkdir(this.stateRoot, { recursive: true });
    return { data: await realpath(this.dataRoot), state: await directory(this.stateRoot, ["material-intake"]) };
  }
  async load(goalId: string, goal: Goal): Promise<{ receipt: Receipt; catalog: CognitiveLocalOutcomeCatalog; root: string } | null> {
    const roots = await this.roots();
    let value: unknown;
    try { value = JSON.parse((await boundedRead(join(roots.state, this.key(goalId) + ".json"), 65_536)).toString("utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    shape(value, ["version", "goalId", "goalDigest", "rootDigest", "requestDigest", "manifest"]);
    if (value.version !== 1 || value.goalId !== goalId || value.goalDigest !== cognitiveDigest(goal) || value.rootDigest !== sha(roots.data) || typeof value.requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.requestDigest)) throw Error("Material Goal or root changed; review required");
    const receipt = value as unknown as Receipt;
    return { receipt, catalog: new CognitiveLocalOutcomeCatalog(roots.data, receipt.manifest, goalId, goal), root: roots.data };
  }
  summary(receipt: Receipt) {
    return { id: receipt.requestDigest, outputs: receipt.manifest.outcomes.map(o => ({ id: o.id, format: receipt.manifest.materials.find(m => m.id === o.materialId)!.format, criteria: o.criteria })) };
  }
  async prepare(goalId: string, goal: Goal, value: unknown, beforeNew: () => Promise<void>) {
    const input = validateMaterialIntake(value);
    if (input.goalId !== goalId || input.goalDigest !== cognitiveDigest(goal)) throw Error("Current Goal changed; refresh before material intake");
    const requestDigest = cognitiveDigest(input), previous = await this.load(goalId, goal);
    if (previous) {
      if (previous.receipt.requestDigest !== requestDigest) throw Error("Material contract changed; existing work is preserved");
      // Retries cannot conceal changed staged source bytes.
      for (const m of previous.receipt.manifest.materials) if (sha(await boundedRead(await containedFile(previous.root, m.path), 65_536)) !== m.sha256) throw Error("Material source changed");
      return this.summary(previous.receipt);
    }
    await beforeNew();
    const roots = await this.roots(); const key = this.key(goalId); const prefix = `goriq-materials/${key}`;
    const manifest: CognitiveLocalOutcomeManifest = { version: 1, goalId, materials: [], outcomes: [] };
    input.materials.forEach((m, i) => {
      const id = `material-${i + 1}`, spec = formats[m.format];
      manifest.materials.push({ id, path: `${prefix}/source-${i + 1}.txt`, sha256: sha(m.content), format: m.format });
      manifest.outcomes.push({ id: `output-${i + 1}`, materialId: id, path: `${prefix}/output-${i + 1}.${spec.extension}`, domain: spec.domain, criteria: m.criteria });
    });
    new CognitiveLocalOutcomeCatalog(roots.data, manifest, goalId, goal);
    await directory(roots.data, ["goriq-materials", key]);
    for (const [i, material] of manifest.materials.entries()) await publish(join(roots.data, material.path), Buffer.from(input.materials[i].content));
    const receipt: Receipt = { version: 1, goalId, goalDigest: cognitiveDigest(goal), rootDigest: sha(roots.data), requestDigest, manifest };
    await publish(join(roots.state, key + ".json"), Buffer.from(JSON.stringify(receipt)));
    return this.summary(receipt);
  }
  async output(goalId: string, goal: Goal, outputId: string, verifiedIds: string[]) {
    const bound = await this.load(goalId, goal); if (!bound) throw Error("Material output is unavailable");
    const output = bound.receipt.manifest.outcomes.find(o => o.id === outputId); if (!output) throw Error("Unknown material output");
    const candidates = await bound.catalog.candidates(verifiedIds);
    const candidate = candidates.find(c => (c.action.input as { outcomeId?: string }).outcomeId === outputId);
    if (!candidate || !verifiedIds.includes(candidate.id)) throw Error("Output must be independently verified first");
    const checked = await bound.catalog.verifier({ async verify() { return { ok: false, summary: "No fallback output verification" }; } }).verify({ goal, action: candidate.action, result: { actionId: candidate.action.id, ok: true, summary: "Download readback" }, context: [] });
    if (!checked.ok) throw Error("Output no longer matches verified material");
    const bytes = await boundedRead(await containedFile(bound.root, output.path), 1_048_576);
    // Verify exact downloaded bytes against the format's deterministic source encoding.
    const material = bound.receipt.manifest.materials.find(m => m.id === output.materialId)!;
    const source = await boundedRead(await containedFile(bound.root, material.path), 65_536);
    if (sha(source) !== material.sha256) throw Error("Material source changed");
    const { book, doc } = validateCognitiveMaterial(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source), material.format);
    const expected = book ? encodeXlsx(book) : doc ? encodeDocx(doc) : source;
    if (!bytes.equals(expected)) throw Error("Output changed before download");
    const spec = formats[material.format];
    return { bytes, contentType: spec.type, filename: `${output.id}.${spec.extension}` };
  }
}
