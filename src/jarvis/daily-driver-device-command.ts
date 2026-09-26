export type SafeDeviceTask = {
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

const PROTECTED_TERMS = [
  "再起動", "reboot", "ロック", "lock", "初期化", "factory reset",
  "削除", "delete", "承認", "approve", "権限", "permission",
  "支払", "billing", "credential", "認証情報",
];

const OPEN_TERMS = /(開いて|開く|起動して|起動する|表示して|アクセスして|open|launch)/i;

export type DailyDriverDeviceIntent =
  | { kind: "device"; task: SafeDeviceTask }
  | { kind: "protected"; message: string }
  | { kind: "not-device" };

export function parseDailyDriverDeviceCommand(input: string): DailyDriverDeviceIntent {
  const text = input.trim();
  if (!text) return { kind: "not-device" };
  const lower = text.toLowerCase();

  if (PROTECTED_TERMS.some((term) => lower.includes(term.toLowerCase()))) {
    return {
      kind: "protected",
      message: "保護対象の端末操作は自動実行しません。既存のHuman Gateまたは端末詳細画面を使用してください。",
    };
  }

  if (/(画面.*(起こ|オン)|wake(?:\\s|$))/i.test(text)) {
    return { kind: "device", task: { type: "wake-device", payload: {} } };
  }

  if ((/wi-?fi|wifi|ワイファイ/i.test(text)) && OPEN_TERMS.test(text)) {
    return { kind: "device", task: { type: "launch-settings", payload: { screen: "wifi" } } };
  }

  if ((/bluetooth|ブルートゥース/i.test(text)) && OPEN_TERMS.test(text)) {
    return { kind: "device", task: { type: "launch-settings", payload: { screen: "bluetooth" } } };
  }

  if (/^(?:端末|スマホ|android)?\\s*設定(?:を)?(?:開いて|開く|表示して)$/i.test(text)) {
    return { kind: "device", task: { type: "launch-settings", payload: { screen: "settings" } } };
  }

  if (/(?:端末|スマホ|android).*(?:状態|ステータス)|(?:状態|ステータス).*(?:端末|スマホ|android)/i.test(text)) {
    return { kind: "device", task: { type: "device-status", payload: {} } };
  }

  for (const app of APP_ALIASES) {
    if (app.terms.some((term) => lower.includes(term.toLowerCase())) && OPEN_TERMS.test(text)) {
      return { kind: "device", task: { type: "open-app", payload: { packageName: app.packageName } } };
    }
  }

  const url = text.match(/https:\/\/[^\s]+/i)?.[0];
  if (url && OPEN_TERMS.test(text)) {
    return { kind: "device", task: { type: "open-url", payload: { url } } };
  }

  if (/^通知[:：\s]/.test(text)) {
    const message = text.replace(/^通知[:：]?\s*/, "").trim();
    if (message) return { kind: "device", task: { type: "show-notification", payload: { title: "GORIQ", message } } };
  }

  return { kind: "not-device" };
}
