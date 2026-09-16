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
    .replace(/&#(?:10|13);/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function includesAll(text: string, markers: string[]): boolean {
  return markers.length > 0 && markers.every((marker) => text.includes(normalize(marker)));
}

export function classifyQaScreen(uiDump: string, rules: QaScreenRules = defaultQaScreenRules): { state: QaScreenState; matched: string[] } {
  // Only visible/accessibility labels count, never resource IDs or other metadata.
  const labels = [...uiDump.matchAll(/\b(?:text|content-desc)="([^"]*)"/g)].map(match => match[1]);
  const text = normalize(labels.join(''));
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

export function validateQaSheetUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' || url.port || url.username || url.password ||
      !/^\/spreadsheets\/d\/[A-Za-z0-9_-]+(?:\/(?:edit|view))?\/?$/.test(url.pathname) ||
      (url.hash && !/^#gid=\d+$/.test(url.hash)) ||
      [...url.searchParams.keys()].some(key => !['gid','usp'].includes(key))) {
    throw Error('Google spreadsheet URL required (optional gid tab only)');
  }
  return url.href;
}

export interface QaSequenceDriver {
  open(step: 1 | 2): Promise<void>;
  wait(step: 1 | 2): Promise<{ state: QaScreenState; matched: string[] }>;
  returnToSheet(): Promise<void>;
  closeAndHome(): Promise<void>;
  progress(stage: string, step: 1 | 2): void;
}

// One bounded run. Never resend an input after an uncertain result.
export async function executeQaSequence(driver: QaSequenceDriver): Promise<QaSequenceResult> {
  for (const step of [1, 2] as const) {
    driver.progress(`opening-step${step}`, step);
    await driver.open(step);
    driver.progress(`waiting-step${step}`, step);
    const observed = await driver.wait(step);
    if (observed.state === 'error') {
      driver.progress('closing-app-after-error', step);
      await driver.closeAndHome();
      return { outcome: 'error-no-retry', step, matched: observed.matched, appClosed: true };
    }
    if (observed.state !== `step${step}-success`) {
      return { outcome: step === 1 ? 'step1-timeout' : 'step2-timeout', step, matched: [], appClosed: false };
    }
    if (step === 1) {
      driver.progress('returning-to-sheet', step);
      await driver.returnToSheet();
    } else {
      driver.progress('closing-app', step);
      await driver.closeAndHome();
      return { outcome: 'done', step, matched: observed.matched, appClosed: true };
    }
  }
  throw Error('Sequence did not finish');
}
