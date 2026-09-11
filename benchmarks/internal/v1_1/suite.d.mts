import type { BenchmarkVerifier } from "../../../src/gai/typed-benchmark-verifier.ts";

export interface BenchmarkCase {
  id: string;
  category: string;
  split: "train" | "heldout";
  difficulty: number;
  risk: "LOW";
  prompt: string;
  verifier: BenchmarkVerifier;
  promptSha256: string;
  transferGroup?: string;
}

export const suiteMeta: Readonly<{
  suiteId: string;
  version: string;
  frozenAt: string;
  expectedCaseCount: number;
  heldoutPolicy: string;
  verifierPolicy: string;
}>;

export const benchmarkCases: readonly Readonly<BenchmarkCase>[];
