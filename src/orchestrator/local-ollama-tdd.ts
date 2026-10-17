import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const localOllamaFixtureSourcePath = "tests/fixtures/goriq_goal_add.py";
export const localOllamaFixtureTestPath = "tests/fixtures/goriq_goal_add_test.py";
export const localOllamaFixtureTest = [
  "from pathlib import Path",
  "import runpy",
  "source = Path(__file__).with_name('goriq_goal_add.py')",
  "assert source.is_file(), 'TDD_RED_MISSING_SOURCE'",
  "namespace = runpy.run_path(str(source))",
  "assert namespace['add'](2, 3) == 5, 'ADD_POSITIVE'",
  "assert namespace['add'](-2, 2) == 0, 'ADD_ZERO'",
  "",
].join("\n");

export type LocalTddPhase = "red" | "green";
export interface LocalTddResult {
  ok: boolean;
  blocker?: string;
  evidence?: {
    phase: LocalTddPhase;
    outcome: "RED_FAIL_OBSERVED" | "GREEN_PASS_OBSERVED";
    testSha256: string;
    artifactSha256: string;
    patchDigest: string;
    candidateRevision: string;
    baseRevision: string;
    verifierId: string;
    origin: string;
    exitCode: number;
    checks: string[];
    recordedAt: string;
  };
  evidenceDigest?: string;
}
export function runLocalTddVerification(
  workspace: string, baseRevision: string, phase: LocalTddPhase,
): LocalTddResult {
  // This executable is neither the model nor the local 8796/8797 Builder.
  const executable = fileURLToPath(new URL("../../scripts/jarvis-local-ollama-tdd-verifier.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [executable], {
    input: JSON.stringify({ workspace, baseRevision, phase }),
    encoding: "utf8",
    timeout: 16000,
    maxBuffer: 16384,
    windowsHide: true,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SystemDrive: process.env.SystemDrive },
  });
  if (child.error || child.status === null || !child.stdout) {
    return { ok: false, blocker: "INDEPENDENT_TDD_VERIFIER_UNAVAILABLE" };
  }
  try {
    const result = JSON.parse(child.stdout.trim()) as LocalTddResult;
    if (child.status !== 0 || result.ok !== true || result.evidence?.phase !== phase ||
        result.evidence?.baseRevision !== baseRevision ||
        !/^[a-f0-9]{64}$/.test(result.evidence?.candidateRevision ?? "") ||
        !/^[a-f0-9]{64}$/.test(result.evidence?.patchDigest ?? "") ||
        result.evidence?.verifierId !== "local-tdd-separate-process" ||
        result.evidence?.outcome !== (phase === "red" ? "RED_FAIL_OBSERVED" : "GREEN_PASS_OBSERVED") ||
        !/^[a-f0-9]{64}$/.test(result.evidenceDigest ?? "") ||
        createHash("sha256").update(JSON.stringify(result.evidence)).digest("hex") !== result.evidenceDigest) {
      return { ok: false, blocker: result.blocker || "INDEPENDENT_TDD_EVIDENCE_INVALID" };
    }
    return result;
  } catch {
    return { ok: false, blocker: "INDEPENDENT_TDD_VERIFIER_MALFORMED" };
  }
}
