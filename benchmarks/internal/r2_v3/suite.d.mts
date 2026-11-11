import type { BenchmarkVerifier } from "../../../src/gai/typed-benchmark-verifier.ts";

export interface R2FreshV3BenchmarkCase {
  id: string;
  category: string;
  split: "train" | "validation" | "heldout";
  prompt: string;
  verifier: BenchmarkVerifier;
  promptSha256: string;
}

export const suiteMeta: Readonly<{
  suiteId: string;
  version: string;
  frozenAt: string;
  expectedCaseCount: number;
  splitPolicy: string;
  purpose: string;
}>;

export const benchmarkCases: readonly Readonly<R2FreshV3BenchmarkCase>[];
