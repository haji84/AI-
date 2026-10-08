import {
  parseDailyDriverDeviceCommand,
  type SafeDeviceTask,
} from "../../../jarvis/daily-driver-device-command.ts";

export type SafeVoiceTask = SafeDeviceTask;

export type VoiceIntentResult =
  | { ok: true; task: SafeVoiceTask }
  | { ok: false; reason: "empty" | "protected" | "unsupported"; message: string };

export function parseSafeMobileCommand(input: string): VoiceIntentResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "empty", message: "音声または文字で指示を入力してください。" };
  const parsed = parseDailyDriverDeviceCommand(text);
  if (parsed.kind === "device") return { ok: true, task: parsed.task };
  if (parsed.kind === "protected") return { ok: false, reason: "protected", message: parsed.message };
  return {
    ok: false,
    reason: "unsupported",
    message: "この指示は端末の直接操作として安全に解釈できません。普段の依頼はGORIQホームから送ってください。",
  };
}

export const parseSafeVoiceCommand = parseSafeMobileCommand;
