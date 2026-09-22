import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalArtifactVerifier, type LocalArtifactExpectation } from "../src/orchestrator/local-artifact-verifier.ts";
import { LocalDocumentCapability } from "../src/orchestrator/local-document-capability.ts";
import { LocalFileCapability } from "../src/orchestrator/local-file-capability.ts";
import { LocalSpreadsheetCapability } from "../src/orchestrator/local-spreadsheet-capability.ts";
import type { WorkAction, WorkDomain } from "../src/orchestrator/work-capability.ts";

function action(
  capability: string,
  domain: WorkDomain,
  operation: string,
  path: string,
  input: Record<string, unknown> = {},
): WorkAction {
  return {
    goalId: "g",
    jobId: "j",
    attemptId: "a",
    strategyId: "s",
    capability,
    domain,
    operation,
    input: { path, ...input },
    scope: [{ kind: "filesystem", ids: ["workspace"] }],
    expectedOutputs: [],
    risk: "low",
    access: operation === "read" ? "read" : "write",
    externalSideEffect: false,
    irreversible: false,
    verifier: { kind: "artifact.persisted_exact", required: true, spec: {} },
  };
}

async function createFixture(root: string) {
  const files = new LocalFileCapability(root);
  const spreadsheets = new LocalSpreadsheetCapability(root);
  const documents = new LocalDocumentCapability(root);

  const sourceText = "owner-independent source record\nrow=42";
  const workbook = {
    cells: [
      { sheet: "Summary", cell: "A1", value: "row" },
      { sheet: "Summary", cell: "B1", value: 42 },
    ],
  };
  const document = {
    title: "Verified report",
    sections: {
      Summary: "row=42",
      Evidence: "derived from verified spreadsheet",
    },
  };

  const source = await files.execute(action("file.local", "file", "write", "source/input.txt", { text: sourceText }));
  const spreadsheet = await spreadsheets.execute(action("spreadsheet.local", "spreadsheet", "write", "derived/report.xlsx", { workbook }));
  const doc = await documents.execute(action("document.local", "document", "write", "derived/report.docx", { document }));
  assert.equal(source.ok, true);
  assert.equal(spreadsheet.ok, true);
  assert.equal(doc.ok, true);

  const expectations: LocalArtifactExpectation[] = [
    {
      domain: "file",
      path: "source/input.txt",
      expectedSha256: String(source.outputs.sha256),
      expectedText: sourceText,
    },
    {
      domain: "spreadsheet",
      path: "derived/report.xlsx",
      expectedSha256: String(spreadsheet.outputs.sha256),
      workbook,
    },
    {
      domain: "document",
      path: "derived/report.docx",
      expectedSha256: String(doc.outputs.sha256),
      document,
    },
  ];

  return { sourceText, workbook, document, expectations };
}

test("persisted verifier independently re-reads File/XLSX/DOCX and emits content-free PASS evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-artifact-verify-"));
  try {
    const fixture = await createFixture(root);
    const verifier = new LocalArtifactVerifier(root);

    for (const expectation of fixture.expectations) {
      const result = await verifier.verify(expectation);
      assert.equal(result.ok, true);
      assert.equal(result.status, "PASS");
      assert.equal(result.evidence.status, "PASS");
      assert.equal(result.evidence.domain, expectation.domain);
      assert.equal(result.evidence.expectedSha256, expectation.expectedSha256);
      assert.equal(result.evidence.actualSha256, expectation.expectedSha256);
      assert.deepEqual(result.evidence.checks, { persisted: true, hash: true, semantic: true });
    }

    const evidenceJson = JSON.stringify(await verifier.verify(fixture.expectations[0]));
    assert.doesNotMatch(evidenceJson, /owner-independent source record/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted verifier fails closed on semantic mismatch and post-write tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-artifact-tamper-"));
  try {
    const fixture = await createFixture(root);
    const verifier = new LocalArtifactVerifier(root);

    const wrongWorkbook: LocalArtifactExpectation = {
      domain: "spreadsheet",
      path: "derived/report.xlsx",
      expectedSha256: fixture.expectations[1].expectedSha256,
      workbook: { cells: [{ sheet: "Summary", cell: "A1", value: "wrong" }] },
    };
    const semanticFailure = await verifier.verify(wrongWorkbook);
    assert.equal(semanticFailure.ok, false);
    assert.equal(semanticFailure.evidence.checks.persisted, true);
    assert.equal(semanticFailure.evidence.checks.hash, true);
    assert.equal(semanticFailure.evidence.checks.semantic, false);
    assert.match(semanticFailure.evidence.reason ?? "", /semantic content/);

    await writeFile(join(root, "source/input.txt"), "tampered after creation", "utf8");
    const hashFailure = await verifier.verify(fixture.expectations[0]);
    assert.equal(hashFailure.ok, false);
    assert.equal(hashFailure.evidence.checks.persisted, true);
    assert.equal(hashFailure.evidence.checks.hash, false);
    assert.match(hashFailure.evidence.reason ?? "", /SHA-256/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lineage binds verified source -> spreadsheet -> document parent hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-artifact-lineage-"));
  try {
    const fixture = await createFixture(root);
    const verifier = new LocalArtifactVerifier(root);
    const lineage = await verifier.buildLineage([
      { artifact: fixture.expectations[0] },
      { artifact: fixture.expectations[1], parentIndexes: [0] },
      { artifact: fixture.expectations[2], parentIndexes: [1] },
    ]);

    assert.equal(lineage.ok, true);
    assert.equal(lineage.status, "PASS");
    assert.match(lineage.evidence.digest ?? "", /^[a-f0-9]{64}$/);
    assert.equal(lineage.evidence.nodes.length, 3);
    assert.equal(lineage.verifications.length, 3);
    assert.ok(lineage.verifications.every((verification) => verification.status === "PASS"));
    assert.deepEqual(lineage.evidence.nodes[1].parentIds, [lineage.evidence.nodes[0].id]);
    assert.deepEqual(lineage.evidence.nodes[1].parentSha256s, [fixture.expectations[0].expectedSha256]);
    assert.deepEqual(lineage.evidence.nodes[2].parentIds, [lineage.evidence.nodes[1].id]);
    assert.deepEqual(lineage.evidence.nodes[2].parentSha256s, [fixture.expectations[1].expectedSha256]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lineage refuses tampered/unverified artifacts, duplicates, and self/future parents", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-artifact-lineage-fail-"));
  try {
    const fixture = await createFixture(root);
    const verifier = new LocalArtifactVerifier(root);

    const selfParent = await verifier.buildLineage([
      { artifact: fixture.expectations[0] },
      { artifact: fixture.expectations[1], parentIndexes: [1] },
    ]);
    assert.equal(selfParent.ok, false);
    assert.match(selfParent.evidence.reason ?? "", /self, future, or invalid parent/);

    const duplicate = await verifier.buildLineage([
      { artifact: fixture.expectations[0] },
      { artifact: fixture.expectations[0], parentIndexes: [0] },
    ]);
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.evidence.reason ?? "", /duplicate artifact lineage target/);

    await writeFile(join(root, "source/input.txt"), "tampered parent", "utf8");
    const tamperedParent = await verifier.buildLineage([
      { artifact: fixture.expectations[0] },
      { artifact: fixture.expectations[1], parentIndexes: [0] },
      { artifact: fixture.expectations[2], parentIndexes: [1] },
    ]);
    assert.equal(tamperedParent.ok, false);
    assert.equal(tamperedParent.evidence.failedIndex, 0);
    assert.equal(tamperedParent.verifications[0]?.status, "FAIL");
    assert.deepEqual(tamperedParent.evidence.nodes, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifier rejects malformed digest and domain-extension mismatches without reading outside scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "jarvis-artifact-contract-"));
  try {
    const fixture = await createFixture(root);
    const verifier = new LocalArtifactVerifier(root);

    const badDigest = await verifier.verify({
      domain: "file",
      path: "source/input.txt",
      expectedSha256: "not-a-digest",
    });
    assert.equal(badDigest.ok, false);
    assert.match(badDigest.evidence.reason ?? "", /expectedSha256/);

    const wrongExtension = await verifier.verify({
      domain: "spreadsheet",
      path: "source/input.txt",
      expectedSha256: fixture.expectations[0].expectedSha256,
      workbook: fixture.workbook,
    });
    assert.equal(wrongExtension.ok, false);
    assert.match(wrongExtension.evidence.reason ?? "", /\.xlsx/);

    const traversal = await verifier.verify({
      domain: "file",
      path: "../escape.txt",
      expectedSha256: fixture.expectations[0].expectedSha256,
    });
    assert.equal(traversal.ok, false);
    assert.match(traversal.evidence.reason ?? "", /escapes allowed root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
