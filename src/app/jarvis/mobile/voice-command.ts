export type SafeVoiceTask = {
  type: "open-url" | "open-app" | "launch-settings" | "wake-device" | "device-status" | "show-notification";
  payload: Record<string, unknown>;
};

const APP_ALIASES: Array<{ terms: string[]; packageName: string }> = [
  { terms: ["スプレッドシート", "sheets"], packageName: "com.google.android.apps.docs.editors.sheets" },
  { terms: ["youtube", "ユーチューブ"], packageName: "com.google.android.youtube" },
  { terms: ["chrome", "クローム"], packageName: "com.android.chrome" },
  { terms: ["マップ", "maps"], packageName: "com.google.android.apps.maps" },
  { terms: ["gmail", "ジーメール"], packageName: "com.google.android.gm" },
];

const BLOCKED_TERMS = [
  "再起動",
  "reboot",
  "ロック",
  "lock",
  "初期化",
  "factory reset",
  "削除",
  "delete",
  "承認",
  "approve",
  "権限",
  "permission",
  "支払",
  "billing",
  "credential",
  "認証情報",
];

export type VoiceIntentResult =
  | { ok: true; task: SafeVoiceTask }
  | { ok: false; reason: "empty" | "protected" | "unsupported"; message: string };

export function parseSafeMobileCommand(input: string): VoiceIntentResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "empty", message: "音声または文字で指示を入力してください。" };
  const lower = text.toLowerCase();

  if (BLOCKED_TERMS.some((term) => lower.includes(term.toLowerCase()))) {
    return {
      ok: false,
      reason: "protected",
      message: "保護対象の操作は音声・文字司令から実行も承認もしません。通常のGORIQ画面とHuman Gateを使ってください。",
    };
  }

  if (text.includes("起こ") || text.includes("画面オン") || lower === "wake") {
    return { ok: true, task: { type: "wake-device", payload: {} } };
  }
  if (lower.includes("wifi") || text.includes("Wi-Fi") || text.includes("ワイファイ")) {
    return { ok: true, task: { type: "launch-settings", payload: { screen: "wifi" } } };
  }
  if (lower.includes("bluetooth") || text.includes("Bluetooth") || text.includes("ブルートゥース")) {
    return { ok: true, task: { type: "launch-settings", payload: { screen: "bluetooth" } } };
  }
  if (text.includes("設定")) {
    return { ok: true, task: { type: "launch-settings", payload: { screen: "settings" } } };
  }
  if (text.includes("状態") || text.includes("ステータス")) {
    return { ok: true, task: { type: "device-status", payload: {} } };
  }

  for (const app of APP_ALIASES) {
    if (app.terms.some((term) => lower.includes(term.toLowerCase()))) {
      return { ok: true, task: { type: "open-app", payload: { packageName: app.packageName } } };
    }
  }

  const url = text.match(/https:\/\/\S+/i)?.[0];
  if (url) return { ok: true, task: { type: "open-url", payload: { url } } };

  if (text.startsWith("通知")) {
    const message = text.replace(/^通知[:：]?\s*/, "") || "GORIQからの通知";
    return { ok: true, task: { type: "show-notification", payload: { title: "GORIQ", message } } };
  }

  return {
    ok: false,
    reason: "unsupported",
    message: "この指示はまだ安全に解釈できません。通常の操作画面を使ってください。",
  };
}

export const parseSafeVoiceCommand = parseSafeMobileCommand;
