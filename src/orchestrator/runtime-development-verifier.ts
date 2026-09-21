import type { Verifier } from "./goal-loop.ts";

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function evidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function createRuntimeDevelopmentVerifier(): Verifier {
  return {
    async verify({ action, result }) {
      if (!result.ok) return { ok: false, summary: result.summary, evidence: result.evidence };
      if (action.capability !== "code.builder") {
        return { ok: true, summary: "Capability execution verified", evidence: result.evidence };
      }

      const input = action.input as { files?: unknown } | undefined;
      const expectedFiles = stringList(input?.files);
      const evidence = result.evidence as { remoteEvidence?: unknown } | undefined;
      const remote = evidence?.remoteEvidence as {
        changedFiles?: unknown;
        diffCheckPassed?: unknown;
        diffCheckOutput?: unknown;
      } | undefined;
      const changedFiles = stringList(remote?.changedFiles);

      if (remote?.diffCheckPassed !== true) {
        return {
          ok: false,
          summary: "Builder diff verification failed",
          evidence: { ...evidenceRecord(result.evidence), diffCheckOutput: remote?.diffCheckOutput ?? null },
        };
      }
      if (changedFiles.length === 0) {
        return { ok: false, summary: "Builder produced no changed-file evidence", evidence: result.evidence };
      }
      if (expectedFiles.length > 0) {
        const allowed = new Set(expectedFiles);
        const unexpected = changedFiles.filter((path) => !allowed.has(path));
        if (unexpected.length > 0) {
          return {
            ok: false,
            summary: `Builder changed files outside the approved scope: ${unexpected.join(", ")}`,
            evidence: { ...evidenceRecord(result.evidence), expectedFiles, changedFiles, unexpected },
          };
        }
      }

      return {
        ok: true,
        summary: "Builder change scope and git diff verification passed",
        evidence: { ...evidenceRecord(result.evidence), expectedFiles, changedFiles },
      };
    },
  };
}
