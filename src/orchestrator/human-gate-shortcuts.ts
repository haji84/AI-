export type HumanGateShortcut =
  | { kind: "check" }
  | { kind: "approve" }
  | { kind: "none" };

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
