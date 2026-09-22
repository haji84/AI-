import { createHash } from "node:crypto";
import { decodeDocx } from "./local-document-capability.ts";
import { LocalFileCapability } from "./local-file-capability.ts";
import { decodeXlsx } from "./local-spreadsheet-capability.ts";
import type { SandboxDocument } from "./document-sandbox-capability.ts";
import type { SpreadsheetCell, SpreadsheetWorkbook } from "./spreadsheet-sandbox-capability.ts";

export type LocalArtifactDomain = "file" | "spreadsheet" | "document";

interface ArtifactExpectationBase {
  domain: LocalArtifactDomain;
  path: string;
  expectedSha256: string;
}

export interface FileArtifactExpectation extends ArtifactExpectationBase {
  domain: "file";
  expectedText?: string;
}

export interface SpreadsheetArtifactExpectation extends ArtifactExpectationBase {
  domain: "spreadsheet";
  workbook: SpreadsheetWorkbook;
}

export interface DocumentArtifactExpectation extends ArtifactExpectationBase {
  domain: "document";
  document: SandboxDocument;
}

export type LocalArtifactExpectation =
  | FileArtifactExpectation
  | SpreadsheetArtifactExpectation
  | DocumentArtifactExpectation;

export interface ArtifactVerificationEvidence {
  kind: "artifact.verification";
  status: "PASS" | "FAIL";
  domain: LocalArtifactDomain;
  requestedPath: string;
  path?: string;
  expectedSha256: string;
  actualSha256?: string;
  checks: {
    persisted: boolean;
    hash: boolean;
    semantic: boolean;
  };
  reason?: string;
}

export interface ArtifactVerificationResult {
  ok: boolean;
  status: "PASS" | "FAIL";
  evidence: ArtifactVerificationEvidence;
}

export interface ArtifactLineageInput {
  artifact: LocalArtifactExpectation;
  parentIndexes?: number[];
}

export interface ArtifactLineageNode {
  id: string;
  domain: LocalArtifactDomain;
  path: string;
  sha256: string;
  parentIds: string[];
  parentSha256s: string[];
}

export interface ArtifactLineageEvidence {
  kind: "artifact.lineage";
  status: "PASS" | "FAIL";
  digest?: string;
  nodes: ArtifactLineageNode[];
  failedIndex?: number;
  reason?: string;
}

export interface ArtifactLineageResult {
  ok: boolean;
  status: "PASS" | "FAIL";
  evidence: ArtifactLineageEvidence;
  verifications: ArtifactVerificationEvidence[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_LINEAGE_NODES = 64;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function normalizedCells(workbook: SpreadsheetWorkbook): SpreadsheetCell[] {
  return workbook.cells
    .map((cell) => ({
      sheet: cell.sheet,
      cell: cell.cell,
      ...(cell.value !== undefined ? { value: cell.value } : {}),
      ...(cell.formula !== undefined ? { formula: cell.formula } : {}),
    }))
    .sort((left, right) => {
      const sheet = left.sheet.localeCompare(right.sheet);
      return sheet || left.cell.localeCompare(right.cell);
    });
}

function workbookMatches(actual: SpreadsheetWorkbook, expected: SpreadsheetWorkbook): boolean {
  return stableJson(normalizedCells(actual)) === stableJson(normalizedCells(expected));
}

function documentMatches(actual: SandboxDocument, expected: SandboxDocument): boolean {
  return stableJson(actual) === stableJson(expected);
}

function validateExpectation(expectation: LocalArtifactExpectation): void {
  if (!expectation.path.trim()) throw new Error("artifact path must not be empty");
  if (!SHA256_PATTERN.test(expectation.expectedSha256)) throw new Error("expectedSha256 must be a lowercase SHA-256 hex digest");
  if (expectation.domain === "spreadsheet" && !expectation.path.toLowerCase().endsWith(".xlsx")) {
    throw new Error("spreadsheet artifact must use an .xlsx path");
  }
  if (expectation.domain === "document" && !expectation.path.toLowerCase().endsWith(".docx")) {
    throw new Error("document artifact must use a .docx path");
  }
}

export class LocalArtifactVerifier {
  private readonly files: LocalFileCapability;

  constructor(root: string) {
    this.files = new LocalFileCapability(root);
  }

  async verify(expectation: LocalArtifactExpectation): Promise<ArtifactVerificationResult> {
    let requestedPath = typeof expectation.path === "string" ? expectation.path : "";
    let expectedSha256 = typeof expectation.expectedSha256 === "string" ? expectation.expectedSha256 : "";
    try {
      validateExpectation(expectation);
      requestedPath = expectation.path;
      expectedSha256 = expectation.expectedSha256;
      const artifact = await this.files.readBytes(expectation.path);
      const hashMatches = artifact.sha256 === expectation.expectedSha256;
      if (!hashMatches) {
        return this.fail(expectation, "persisted artifact SHA-256 does not match the expected artifact", {
          path: artifact.target,
          actualSha256: artifact.sha256,
          persisted: true,
          hash: false,
        });
      }

      let semanticMatches = true;
      if (expectation.domain === "file" && expectation.expectedText !== undefined) {
        semanticMatches = artifact.bytes.equals(Buffer.from(expectation.expectedText, "utf8"));
      } else if (expectation.domain === "spreadsheet") {
        semanticMatches = workbookMatches(decodeXlsx(artifact.bytes), expectation.workbook);
      } else if (expectation.domain === "document") {
        semanticMatches = documentMatches(decodeDocx(artifact.bytes), expectation.document);
      }

      if (!semanticMatches) {
        return this.fail(expectation, "persisted artifact semantic content does not match the verifier contract", {
          path: artifact.target,
          actualSha256: artifact.sha256,
          persisted: true,
          hash: true,
          semantic: false,
        });
      }

      return {
        ok: true,
        status: "PASS",
        evidence: {
          kind: "artifact.verification",
          status: "PASS",
          domain: expectation.domain,
          requestedPath: expectation.path,
          path: artifact.target,
          expectedSha256: expectation.expectedSha256,
          actualSha256: artifact.sha256,
          checks: { persisted: true, hash: true, semantic: true },
        },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "artifact verification failed";
      return {
        ok: false,
        status: "FAIL",
        evidence: {
          kind: "artifact.verification",
          status: "FAIL",
          domain: expectation.domain,
          requestedPath,
          expectedSha256,
          checks: { persisted: false, hash: false, semantic: false },
          reason,
        },
      };
    }
  }

  async buildLineage(inputs: ArtifactLineageInput[]): Promise<ArtifactLineageResult> {
    const verifications: ArtifactVerificationEvidence[] = [];
    const nodes: ArtifactLineageNode[] = [];
    try {
      if (inputs.length === 0) throw new Error("artifact lineage requires at least one node");
      if (inputs.length > MAX_LINEAGE_NODES) throw new Error("artifact lineage exceeds the node limit");

      const seenTargets = new Set<string>();
      for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        validateExpectation(input.artifact);
        const targetKey = `${input.artifact.domain}:${input.artifact.path}`;
        if (seenTargets.has(targetKey)) throw new Error(`duplicate artifact lineage target at index ${index}`);
        seenTargets.add(targetKey);

        const parents = input.parentIndexes ?? (index === 0 ? [] : [index - 1]);
        if (index === 0 && parents.length) throw new Error("lineage root cannot have a parent");
        if (index > 0 && parents.length === 0) throw new Error(`lineage node ${index} must have at least one parent`);
        if (new Set(parents).size !== parents.length) throw new Error(`lineage node ${index} has duplicate parents`);
        for (const parent of parents) {
          if (!Number.isInteger(parent) || parent < 0 || parent >= index) {
            throw new Error(`lineage node ${index} references a self, future, or invalid parent`);
          }
        }

        const verification = await this.verify(input.artifact);
        verifications.push(verification.evidence);
        if (!verification.ok || !verification.evidence.path || !verification.evidence.actualSha256) {
          return {
            ok: false,
            status: "FAIL",
            evidence: {
              kind: "artifact.lineage",
              status: "FAIL",
              nodes,
              failedIndex: index,
              reason: `artifact at index ${index} did not pass independent persisted verification`,
            },
            verifications,
          };
        }

        const parentNodes = parents.map((parent) => nodes[parent]);
        const identity = {
          domain: input.artifact.domain,
          path: verification.evidence.path,
          sha256: verification.evidence.actualSha256,
          parentIds: parentNodes.map((parent) => parent.id),
          parentSha256s: parentNodes.map((parent) => parent.sha256),
        };
        nodes.push({
          id: sha256(stableJson(identity)),
          ...identity,
        });
      }

      return {
        ok: true,
        status: "PASS",
        evidence: {
          kind: "artifact.lineage",
          status: "PASS",
          digest: sha256(stableJson(nodes)),
          nodes,
        },
        verifications,
      };
    } catch (error) {
      return {
        ok: false,
        status: "FAIL",
        evidence: {
          kind: "artifact.lineage",
          status: "FAIL",
          nodes,
          reason: error instanceof Error ? error.message : "artifact lineage validation failed",
        },
        verifications,
      };
    }
  }

  private fail(
    expectation: LocalArtifactExpectation,
    reason: string,
    state: {
      path?: string;
      actualSha256?: string;
      persisted: boolean;
      hash: boolean;
      semantic?: boolean;
    },
  ): ArtifactVerificationResult {
    return {
      ok: false,
      status: "FAIL",
      evidence: {
        kind: "artifact.verification",
        status: "FAIL",
        domain: expectation.domain,
        requestedPath: expectation.path,
        ...(state.path ? { path: state.path } : {}),
        expectedSha256: expectation.expectedSha256,
        ...(state.actualSha256 ? { actualSha256: state.actualSha256 } : {}),
        checks: {
          persisted: state.persisted,
          hash: state.hash,
          semantic: state.semantic ?? false,
        },
        reason,
      },
    };
  }
}
