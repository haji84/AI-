import crypto from "node:crypto";

export interface CurriculumTask {
  id: string;
  prompt: string;
  sourceFailureIds: string[];
  difficulty: number;
}

export interface CurriculumGuardResult {
  accepted: CurriculumTask[];
  rejected: Array<{ task: CurriculumTask; reason: string }>;
}

export function taskFingerprint(prompt: string): string {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function guardCurriculum(
  candidates: readonly CurriculumTask[],
  heldoutIds: ReadonlySet<string>,
  heldoutFingerprints: ReadonlySet<string>,
): CurriculumGuardResult {
  const accepted: CurriculumTask[] = [];
  const rejected: Array<{ task: CurriculumTask; reason: string }> = [];
  const seen = new Set<string>();
  for (const task of candidates) {
    const fingerprint = taskFingerprint(task.prompt);
    if (heldoutIds.has(task.id)) {
      rejected.push({ task, reason: "candidate reuses a heldout task id" });
      continue;
    }
    if (heldoutFingerprints.has(fingerprint)) {
      rejected.push({ task, reason: "candidate duplicates heldout prompt content" });
      continue;
    }
    if (seen.has(fingerprint)) {
      rejected.push({ task, reason: "duplicate curriculum prompt" });
      continue;
    }
    if (!Number.isFinite(task.difficulty) || task.difficulty < 0) {
      rejected.push({ task, reason: "invalid difficulty" });
      continue;
    }
    seen.add(fingerprint);
    accepted.push(task);
  }
  return { accepted, rejected };
}
