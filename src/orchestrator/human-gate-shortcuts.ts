import type { ReasoningFeedback } from "./reasoning-feedback.ts";

export type HumanGateShortcut =
  | { kind: "check" }
  | { kind: "approve" }
  | { kind: "none" };

export interface HumanGateShortcutState {
  pendingCount: number;
  riskLevel: string | null;
  title: string | null;
  reasons: string[];
  approvalKey: string | null;
  blocked: boolean;
}

export interface HumanGateShortcutResolution {
  kind: "check" | "approve";
  state: HumanGateShortcutState;
  approvedActionKey: string | null;
  message: string;
}

const CHECK_COMMANDS = new Set(["チェック", "確認", "判子チェック", "ハンコチェック"]);
const APPROVE_COMMANDS = new Set(["判子", "ハンコ", "承認", "判子押す", "ハンコ押す"]);

function normalize(value: string): string {
  return value.trim().replace(/[！!。.]$/u, "").trim();
}

export function parseHumanGateShortcut(command: string | null | undefined): HumanGateShortcut {
  const normalized = normalize(command ?? "");
  if (CHECK_COMMANDS.has(normalized)) return { kind: "check" };
  if (APPROVE_COMMANDS.has(normalized)) return { kind: "approve" };
  return { kind: "none" };
}

export function humanGateShortcutState(feedback: ReasoningFeedback | null): HumanGateShortcutState {
  const risk = feedback?.riskDecision ?? null;
  const blocked = risk?.level === "CRITICAL" || risk?.executionBlocked === true;
  const pending = Boolean(
    feedback
    && !blocked
    && feedback.humanApprovalRequired
    && !feedback.approvalSatisfied
    && risk?.level === "HIGH"
    && feedback.approvalKey,
  );
  return {
    pendingCount: pending ? 1 : 0,
    riskLevel: risk?.level ?? null,
    title: pending ? (feedback?.nextAction?.trim() || "高リスク操作の承認") : null,
    reasons: Array.isArray(risk?.reasons) ? risk.reasons : [],
    approvalKey: pending ? feedback?.approvalKey ?? null : null,
    blocked,
  };
}

export function resolveHumanGateShortcut(
  shortcut: Exclude<HumanGateShortcut, { kind: "none" }>,
  feedback: ReasoningFeedback | null,
): HumanGateShortcutResolution {
  const state = humanGateShortcutState(feedback);

  if (shortcut.kind === "check") {
    if (state.blocked) {
      return {
        kind: "check",
        state,
        approvedActionKey: null,
        message: "CRITICALで停止中です。通常の判子では解除できません。",
      };
    }
    return {
      kind: "check",
      state,
      approvedActionKey: null,
      message: state.pendingCount === 1
        ? `判子待ちが1件あります: ${state.title}`
        : "判子待ちはありません。",
    };
  }

  if (state.blocked) {
    return {
      kind: "approve",
      state,
      approvedActionKey: null,
      message: "CRITICALは判子では承認できません。",
    };
  }
  if (state.pendingCount !== 1 || !state.approvalKey) {
    return {
      kind: "approve",
      state,
      approvedActionKey: null,
      message: "承認できる判子待ちが1件だけ存在する状態ではありません。",
    };
  }
  return {
    kind: "approve",
    state,
    approvedActionKey: state.approvalKey,
    message: `1件のHIGH案件を承認して再開します: ${state.title}`,
  };
}
