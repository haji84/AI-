import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { LocalFileCapability } from "../orchestrator/local-file-capability.ts";
import { LocalSpreadsheetCapability, encodeXlsx } from "../orchestrator/local-spreadsheet-capability.ts";
import { LocalDocumentCapability, encodeDocx } from "../orchestrator/local-document-capability.ts";
import { LocalArtifactVerifier, type LocalArtifactExpectation } from "../orchestrator/local-artifact-verifier.ts";
import type { SandboxDocument } from "../orchestrator/document-sandbox-capability.ts";
import type { SpreadsheetWorkbook } from "../orchestrator/spreadsheet-sandbox-capability.ts";
import type { WorkAction } from "../orchestrator/work-capability.ts";
import type { CapabilityRegistry } from "../orchestrator/capabilities.ts";
import type { Goal, ProposedAction, Verifier } from "../orchestrator/goal-loop.ts";
import type { WorkStateAction } from "../orchestrator/work-state-integration.ts";
import { assertCognitiveSafe, cognitiveDigest } from "./cognitive-state.ts";
import type { CognitiveCandidate } from "./cognitive-core.ts";

/** Host-owned materials and desired outcomes. Models cannot supply scope or verification. */
export interface CognitiveLocalOutcomeManifest {
  version: 1;
  goalId: string;
  materials: Array<{ id: string; path: string; sha256: string; format: "text" | "workbook-json" | "document-json" }>;
  outcomes: Array<{ id: string; materialId: string; path: string; domain: "file" | "spreadsheet" | "document"; criteria: string[] }>;
}
type Material = CognitiveLocalOutcomeManifest["materials"][number];
type Outcome = CognitiveLocalOutcomeManifest["outcomes"][number];
const MAX_MATERIAL_BYTES = 65_536;
const MAX_OUTPUT_BYTES = 1_048_576;
const CAPABILITIES = ["cognitive.material.read", "cognitive.outcome.file", "cognitive.outcome.spreadsheet", "cognitive.outcome.document"];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const forbiddenKey = /^(?:__proto__|constructor|prototype)$/;
function shape(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) throw Error(`Invalid ${label} schema`);
}
function text(value: unknown, maximum: number, label: string, empty = false): asserts value is string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > maximum || !value.isWellFormed() || Array.from(value).some(character => { const code = character.charCodeAt(0); return code < 32 && ![9, 10, 13].includes(code) || code === 127 || code === 0xfffe || code === 0xffff; })) throw Error(`Invalid ${label}`);
}
function officeText(value: unknown, maximum: number, label: string, empty = false): asserts value is string {
  text(value, maximum, label, empty);
  // XML 1.0 readers normalize raw CR/CRLF; the reused codecs do not escape it.
  if (value.includes(String.fromCharCode(13))) throw Error("Office text requires LF line endings");
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{1,80}$/.test(value)) throw Error("Invalid local outcome ID");
}
function dataPath(root: string, value: unknown): string {
  text(value, 512, "data path");
  const parts = value.split(/[\\/]/);
  if (isAbsolute(value) || win32.isAbsolute(value) || value.includes(":") || parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) ||
      /^(?:\.git|\.codex|\.ssh|\.env.*|credentials?)$/i.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw Error("Local outcome path outside data scope");
  const target = resolve(root, ...parts);
  const rel = relative(root, target);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) throw Error("Local outcome path outside data scope");
  return target;
}
async function containedFile(root: string, path: string): Promise<string> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw Error("Unsafe local data root");
  const actualRoot = await realpath(root);
  const rel = relative(root, dataPath(root, path));
  let target = actualRoot;
  for (const part of rel.split(sep)) {
    target = resolve(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw Error("Symlink material or artifact is forbidden");
  }
  const actual = await realpath(target);
  const actualRelative = relative(actualRoot, actual);
  if (isAbsolute(actualRelative) || actualRelative === ".." || actualRelative.startsWith(".." + sep)) throw Error("Material outside data scope");
  return actual;
}
/** Fixed-size allocation and handle metadata checks also bound files that grow during a read. */
async function boundedRead(path: string, maximum: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum) throw Error("Local file exceeds bound or is unsafe");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maximum || opened.dev !== before.dev || opened.ino !== before.ino) throw Error("Local file changed before bounded read");
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const chunk = await handle.read(bytes, length, bytes.length - length, length);
      if (!chunk.bytesRead) break;
      length += chunk.bytesRead;
    }
    const after = await handle.stat();
    if (length > maximum || length !== after.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw Error("Local file changed or exceeded bound");
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}
function workbook(value: unknown): SpreadsheetWorkbook {
  shape(value, ["cells"], "workbook");
  if (!Array.isArray(value.cells) || !value.cells.length || value.cells.length > 1024) throw Error("Invalid bounded workbook cells");
  const seen = new Set<string>(); const sheets = new Map<string, string>();
  const cells = value.cells.map(raw => {
    // Formula evaluation is outside this fixed data-copy transform.
    shape(raw, ["sheet", "cell", "value"], "spreadsheet cell (formulas are unsupported)");
    officeText(raw.sheet, 31, "sheet name");
    if (raw.sheet.includes(String.fromCharCode(9)) || raw.sheet.includes(String.fromCharCode(10))) throw Error("Sheet name contains XML attribute whitespace"); text(raw.cell, 10, "cell reference");
    if (/[\\/*?:[\]]/.test(raw.sheet) || raw.sheet.startsWith("'") || raw.sheet.endsWith("'")) throw Error("Invalid sheet name");
    const priorSheet = sheets.get(raw.sheet.toLowerCase());
    if (priorSheet && priorSheet !== raw.sheet) throw Error("Duplicate case-insensitive sheet name");
    sheets.set(raw.sheet.toLowerCase(), raw.sheet);
    if (sheets.size > 16) throw Error("Workbook sheet bound exceeded");
    const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(raw.cell);
    const column = match?.[1].split("").reduce((n, character) => n * 26 + character.charCodeAt(0) - 64, 0) ?? 0;
    if (!match || column > 16_384 || Number(match[2]) > 1_048_576) throw Error("Cell reference outside Excel bounds");
    const key = `${raw.sheet.toLowerCase()}!${raw.cell}`;
    if (seen.has(key)) throw Error("Duplicate workbook cell"); seen.add(key);
    const value = raw.value;
    if (typeof value === "string") officeText(value, 8192, "cell value", true);
    else if (value !== null && typeof value !== "boolean" && (typeof value !== "number" || !Number.isFinite(value))) throw Error("Invalid scalar cell value");
    return { sheet: raw.sheet, cell: raw.cell, value };
  });
  return { cells };
}
function document(value: unknown): SandboxDocument {
  shape(value, ["title", "sections"], "document"); officeText(value.title, 512, "document title");
  if (!value.sections || typeof value.sections !== "object" || Array.isArray(value.sections) || Object.getPrototypeOf(value.sections) !== Object.prototype) throw Error("Invalid document sections");
  const entries = Object.entries(value.sections);
  if (!entries.length || entries.length > 32) throw Error("Invalid document section count");
  const sections: Record<string, string> = {};
  for (const [name, value] of entries) {
    officeText(name, 200, "section name"); officeText(value, MAX_MATERIAL_BYTES, "section text", true);
    if (forbiddenKey.test(name)) throw Error("Invalid section key"); sections[name] = value;
  }
  return { title: value.title, sections };
}

export class CognitiveLocalOutcomeCatalog {
  readonly contractDigest: string;
  private readonly root: string;
  private readonly manifest: CognitiveLocalOutcomeManifest;
  private readonly files: LocalFileCapability;
  constructor(root: string, manifest: CognitiveLocalOutcomeManifest, goalId: string, goal: Goal) {
    this.root = resolve(root);
    assertCognitiveSafe(manifest);
    shape(manifest, ["version", "goalId", "materials", "outcomes"], "outcome manifest");
    if (manifest.version !== 1 || manifest.goalId !== goalId || !Array.isArray(manifest.materials) || !manifest.materials.length || manifest.materials.length > 24 ||
        !Array.isArray(manifest.outcomes) || !manifest.outcomes.length || manifest.outcomes.length > 24 || manifest.materials.length + manifest.outcomes.length > 32) throw Error("Invalid bounded outcome manifest or action budget");
    const materialIds = new Set<string>(); const paths = new Set<string>(); const outcomeIds = new Set<string>();
    for (const material of manifest.materials) {
      shape(material, ["id", "path", "sha256", "format"], "material"); identifier(material.id);
      if (materialIds.has(material.id) || !/^[a-f0-9]{64}$/.test(material.sha256) || !["text", "workbook-json", "document-json"].includes(material.format)) throw Error("Invalid material binding");
      const path = dataPath(this.root, material.path).toLowerCase();
      if (paths.has(path)) throw Error("Duplicate material path"); paths.add(path); materialIds.add(material.id);
    }
    for (const outcome of manifest.outcomes) {
      shape(outcome, ["id", "materialId", "path", "domain", "criteria"], "outcome"); identifier(outcome.id);
      const material = manifest.materials.find(m => m.id === outcome.materialId);
      if (!material || outcomeIds.has(outcome.id) || ({ text: "file", "workbook-json": "spreadsheet", "document-json": "document" } as const)[material.format] !== outcome.domain) throw Error("Unsupported outcome transform");
      const path = dataPath(this.root, outcome.path).toLowerCase();
      if (paths.has(path) || outcome.domain === "spreadsheet" && !path.endsWith(".xlsx") || outcome.domain === "document" && !path.endsWith(".docx")) throw Error("Invalid or overlapping outcome path");
      if (!Array.isArray(outcome.criteria) || !outcome.criteria.length || outcome.criteria.length > 24 || new Set(outcome.criteria).size !== outcome.criteria.length ||
          outcome.criteria.some(c => !goal.successCriteria.some((_, index) => c === `criterion-${index + 1}`))) throw Error("Unknown or missing Goal criterion");
      paths.add(path); outcomeIds.add(outcome.id);
    }
    this.manifest = { version: 1, goalId: manifest.goalId,
      materials: manifest.materials.map(({ id, path, sha256, format }) => ({ id, path, sha256, format })),
      outcomes: manifest.outcomes.map(({ id, materialId, path, domain, criteria }) => ({ id, materialId, path, domain, criteria: [...criteria] })) };
    this.contractDigest = cognitiveDigest({ root: this.root, manifest: this.manifest });
    this.files = new LocalFileCapability(this.root);
  }
  private readId(material: Material) { return "material:" + cognitiveDigest({ root: this.root, goalId: this.manifest.goalId, material }); }
  private outputId(material: Material, outcome: Outcome) { return "outcome:" + cognitiveDigest({ root: this.root, goalId: this.manifest.goalId, material, outcome }); }
  private candidate(material: Material, outcome?: Outcome): CognitiveCandidate {
    const id = outcome ? this.outputId(material, outcome) : this.readId(material);
    const action: WorkStateAction = { id, capability: outcome ? `cognitive.outcome.${outcome.domain}` : "cognitive.material.read",
      description: outcome ? `Create ${outcome.path} from authorized material ${material.id}` : `Inspect authorized material ${material.id}`,
      risk: "low", irreversible: false, externalSideEffect: false, materialMutation: Boolean(outcome),
      satisfiesDefinitionOfDone: outcome ? [...outcome.criteria] : [], input: outcome ? { materialId: material.id, outcomeId: outcome.id } : { materialId: material.id } };
    return { id, kind: "experiment", action, expectedOutcome: outcome ? "Persisted output exactly matches verified source material" : "Source hash and fixed data schema verified",
      evidenceRequired: ["independent-local-artifact-verifier"] };
  }
  async candidates(completedIds: string[] = []): Promise<CognitiveCandidate[]> {
    const candidates = this.manifest.materials.map(material => this.candidate(material));
    for (const outcome of this.manifest.outcomes) {
      const material = this.manifest.materials.find(m => m.id === outcome.materialId)!;
      if (completedIds.includes(this.readId(material))) candidates.push(this.candidate(material, outcome));
    }
    return candidates;
  }
  completionSatisfied(completedIds: string[]): boolean {
    return this.manifest.materials.every(material => completedIds.includes(this.readId(material))) &&
      this.manifest.outcomes.every(outcome => {
        const material = this.manifest.materials.find(m => m.id === outcome.materialId)!;
        return completedIds.includes(this.outputId(material, outcome));
      });
  }
  private binding(action: ProposedAction): { material: Material; outcome?: Outcome } {
    for (const material of this.manifest.materials) {
      const outcome = this.manifest.outcomes.find(o => o.materialId === material.id && this.outputId(material, o) === action.id);
      if (!outcome && this.readId(material) !== action.id) continue;
      const expected = this.candidate(material, outcome).action as WorkStateAction;
      const bound = action as WorkStateAction;
      if (action.capability !== expected.capability || cognitiveDigest(action.input) !== cognitiveDigest(expected.input) || action.risk !== "low" || action.irreversible || action.externalSideEffect ||
          bound.materialMutation !== expected.materialMutation || cognitiveDigest(bound.satisfiesDefinitionOfDone) !== cognitiveDigest(expected.satisfiesDefinitionOfDone)) throw Error("Local outcome action binding mismatch");
      return { material, outcome };
    }
    throw Error("Unknown authorized local outcome action");
  }
  private async prepare(material: Material, outcome?: Outcome) {
    const bytes = await boundedRead(await containedFile(this.root, material.path), MAX_MATERIAL_BYTES);
    if (sha(bytes) !== material.sha256) throw Error("Source material hash mismatch");
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    text(content, MAX_MATERIAL_BYTES, "source material"); assertCognitiveSafe(content);
    const parsed: unknown = material.format === "text" ? content : JSON.parse(content);
    assertCognitiveSafe(parsed);
    const source: LocalArtifactExpectation = { domain: "file", path: material.path, expectedSha256: material.sha256, expectedText: content };
    const book = material.format === "workbook-json" ? workbook(parsed) : undefined;
    const doc = material.format === "document-json" ? document(parsed) : undefined;
    if (!outcome) return { source };
    const outputBytes = book ? encodeXlsx(book) : doc ? encodeDocx(doc) : bytes;
    if (outputBytes.length > MAX_OUTPUT_BYTES) throw Error("Output bound exceeded");
    const base = { path: outcome.path, expectedSha256: sha(outputBytes) };
    const artifact: LocalArtifactExpectation = book ? { ...base, domain: "spreadsheet", workbook: book } : doc ? { ...base, domain: "document", document: doc } : { ...base, domain: "file", expectedText: content };
    const input = book ? { path: outcome.path, workbook: book } : doc ? { path: outcome.path, document: doc } : { path: outcome.path, text: content };
    return { source, artifact, input };
  }
  register(registry: CapabilityRegistry): void {
    for (const capability of CAPABILITIES) registry.register({ name: capability, execute: async action => {
      try {
        const { material, outcome } = this.binding(action);
        const prepared = await this.prepare(material, outcome);
        if (outcome) {
          // Existing targets must be bounded before adapters inspect their bytes for idempotency.
          const existing = await lstat(dataPath(this.root, outcome.path)).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          });
          if (existing) await boundedRead(await containedFile(this.root, outcome.path), MAX_OUTPUT_BYTES);
          const work: WorkAction = { goalId: this.manifest.goalId, jobId: outcome.id, attemptId: action.id, strategyId: action.id,
            capability: `${outcome.domain}.local`, domain: outcome.domain, operation: "write", input: prepared.input!,
            scope: [{ kind: "filesystem", ids: [outcome.path] }], expectedOutputs: [outcome.path], risk: "low", access: "write", externalSideEffect: false, irreversible: false,
            verifier: { kind: "local.source-derived-exact", required: true, spec: {} } };
          const adapter = outcome.domain === "file" ? this.files : outcome.domain === "spreadsheet" ? new LocalSpreadsheetCapability(this.root) : new LocalDocumentCapability(this.root);
          const result = await adapter.execute(work);
          if (!result.ok) return { actionId: action.id, ok: false, summary: "Output unavailable or existing content conflicts", blocker: "local_outcome_write_blocked" };
        }
        return { actionId: action.id, ok: true, summary: outcome ? "Local outcome persisted for independent verification" : "Authorized source material read and schema checked",
          evidence: { refs: ["local-outcome-observation:" + cognitiveDigest({ actionId: action.id, sourceSha256: material.sha256 })] } };
      } catch { return { actionId: action.id, ok: false, summary: "Local material or outcome failed bounded policy checks", blocker: "local_outcome_unavailable" }; }
    } });
  }
  verifier(fallback: Verifier): Verifier {
    return { verify: async input => {
      if (!CAPABILITIES.includes(input.action.capability)) return fallback.verify(input);
      try {
        const { material, outcome } = this.binding(input.action);
        if (!input.result.ok || input.result.actionId !== input.action.id) throw Error("Action result mismatch");
        const prepared = await this.prepare(material, outcome);
        if (outcome) await boundedRead(await containedFile(this.root, outcome.path), MAX_OUTPUT_BYTES);
        const lineage = await new LocalArtifactVerifier(this.root).buildLineage([{ artifact: prepared.source }, ...(prepared.artifact ? [{ artifact: prepared.artifact, parentIndexes: [0] }] : [])]);
        return { ok: lineage.ok, summary: lineage.ok ? "Source and persisted output independently verified" : "Source or persisted output failed independent verification",
          evidence: { refs: ["local-outcome-verification:" + cognitiveDigest({ goalId: this.manifest.goalId, actionId: input.action.id, lineage: lineage.evidence })], lineage: lineage.evidence } };
      } catch { return { ok: false, summary: "Local outcome independent verification failed", evidence: { refs: [], blocker: "local_outcome_verification_failed" } }; }
    } };
  }
}

/** Only a host-configured path is loaded; HTTP and model payloads never choose it. */
export async function loadCognitiveLocalOutcomes(path: string, root: string, goalId: string, goal: Goal) {
  const raw = await boundedRead(path, MAX_MATERIAL_BYTES);
  return new CognitiveLocalOutcomeCatalog(await realpath(root), JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)), goalId, goal);
}
