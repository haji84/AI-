import type { SharedCommandContext, SharedCommandHistoryEntry } from "./command-context";
import { parseSafeMobileCommand } from "./voice-command";

export type SafeContextCandidate = {
  index: number;
  entry: SharedCommandHistoryEntry;
};

export type ContextReferenceResolution =
  | { kind: "none" }
  | { kind: "resolved"; command: string; entryId: string; label: string }
  | { kind: "rejected"; message: string };

function isReusable(entry: SharedCommandHistoryEntry, targetNodeId?: string): boolean {
  if (entry.outcome !== "sent") return false;
  if (entry.command.includes("[REDACTED]")) return false;
  if (targetNodeId && entry.targetNodeId && entry.targetNodeId !== targetNodeId) return false;
  return parseSafeMobileCommand(entry.command).ok;
}

export function getSafeContextCandidates(context: SharedCommandContext): SafeContextCandidate[] {
  return context.history
    .filter((entry) => isReusable(entry, context.targetNodeId))
    .slice()
    .reverse()
    .map((entry, index) => ({ index: index + 1, entry }));
}

function normalizedReference(input: string): string {
  return input.trim().replace(/[。！!？?]+$/g, "").trim();
}

export function resolveSafeContextReference(input: string, context: SharedCommandContext): ContextReferenceResolution {
  const text = normalizedReference(input);
  const candidates = getSafeContextCandidates(context);

  const selectedReference = /^(?:これ|これやって|これを(?:実行|やって))$/.test(text);
  if (selectedReference) {
    if (!context.selectedHistoryId) {
      return { kind: "rejected", message: "「これ」を使うには、共通コマンド履歴で参照する指示を先に選択してください。" };
    }
    const selected = candidates.find((candidate) => candidate.entry.id === context.selectedHistoryId);
    if (!selected) {
      return { kind: "rejected", message: "選択した指示は現在の端末で安全に再利用できません。履歴から別の指示を選んでください。" };
    }
    return { kind: "resolved", command: selected.entry.command, entryId: selected.entry.id, label: "これ" };
  }

  if (/^(?:さっきのやつ|さっきの|前のやつ|前の)$/.test(text)) {
    const latest = candidates[0];
    if (!latest) return { kind: "rejected", message: "現在の端末で安全に再利用できる直近の指示がありません。" };
    return { kind: "resolved", command: latest.entry.command, entryId: latest.entry.id, label: "さっきのやつ" };
  }

  const ordinal = text.match(/^(\d{1,2})番目(?:のやつ|の)?$/);
  if (ordinal) {
    const index = Number(ordinal[1]);
    if (!Number.isInteger(index) || index < 1 || index > 12) {
      return { kind: "rejected", message: "履歴の番号は1〜12番目で指定してください。" };
    }
    const candidate = candidates[index - 1];
    if (!candidate) return { kind: "rejected", message: `現在の端末の${index}番目に安全に再利用できる指示はありません。` };
    return { kind: "resolved", command: candidate.entry.command, entryId: candidate.entry.id, label: `${index}番目` };
  }

  return { kind: "none" };
}
