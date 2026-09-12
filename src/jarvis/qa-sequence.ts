export type QaScreenState = "error" | "step1-success" | "step2-success" | "pending";

export type QaScreenRules = {
  errorAny: string[];
  step1All: string[];
  step2All: string[];
};

export const defaultQaScreenRules: QaScreenRules = {
  errorAny: [
    "お友達のお手伝いが出来ませんでした",
    "あなたのアカウントでエラーが発生しました",
    "別のアカウントでお試しください",
  ],
  step1All: [
    "イベント詳細",
    "新規ユーザー",
    "30日以上アプリを使っていない人",
    "その他の既存ユーザー",
  ],
  step2All: ["受け取りました", "マイQRコードを表示"],
};

function normalize(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#10;/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAll(text: string, markers: string[]): boolean {
  return markers.length > 0 && markers.every((marker) => text.includes(normalize(marker)));
}

export function classifyQaScreen(uiDump: string, rules: QaScreenRules = defaultQaScreenRules): { state: QaScreenState; matched: string[] } {
  const text = normalize(uiDump);
  const errorMatched = rules.errorAny.map(normalize).filter((marker) => marker && text.includes(marker));
  if (errorMatched.length > 0) return { state: "error", matched: errorMatched };

  if (includesAll(text, rules.step2All)) {
    return { state: "step2-success", matched: rules.step2All.map(normalize) };
  }
  if (includesAll(text, rules.step1All)) {
    return { state: "step1-success", matched: rules.step1All.map(normalize) };
  }
  return { state: "pending", matched: [] };
}

export type QaSequenceOutcome =
  | "done"
  | "error-no-retry"
  | "step1-timeout"
  | "step2-timeout";

export type QaSequenceResult = {
  outcome: QaSequenceOutcome;
  step: 1 | 2;
  matched: string[];
  appClosed: boolean;
};
