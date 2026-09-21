export type JarvisDiagnosticState = "ready" | "blocked" | "pending" | "unknown";

export type JarvisDiagnosticCode =
  | "AUTH"
  | "BUILD"
  | "TAILSCALE"
  | "HOST"
  | "BROKER"
  | "GATEWAY"
  | "WORKER"
  | "DEVICE_PERMISSION"
  | "FIRMWARE_GATE"
  | "HUMAN_GATE";

export interface JarvisDiagnosticItem {
  code: JarvisDiagnosticCode;
  label: string;
  state: JarvisDiagnosticState;
  detail: string;
  action?: string;
}

export interface JarvisSelfDiagnosticInput {
  ownerAuthConfigured: boolean;
  brokerAuthConfigured: boolean;
  gatewayAuthConfigured: boolean;
  productionBuildPresent?: boolean;
  tailscale?: "running" | "stopped" | "unknown";
  hostObserved?: boolean;
  broker?: "ready" | "unreachable" | "unconfigured" | "auth-missing" | "unknown";
  gateway?: "ready" | "unreachable" | "unconfigured" | "auth-missing" | "unknown";
  workerTotal?: number;
  workerReady?: number;
  workerOffline?: number;
  devicePermissionBlockers?: string[];
  firmwareGate?: "verified" | "manual-required" | "not-applicable" | "unknown";
  humanGateCount?: number;
}

export interface JarvisSelfDiagnosticReport {
  overall: JarvisDiagnosticState;
  items: JarvisDiagnosticItem[];
}

const labels: Record<JarvisDiagnosticState, string> = {
  ready: "正常",
  blocked: "要対応",
  pending: "確認待ち",
  unknown: "未確認",
};

function item(code: JarvisDiagnosticCode, label: string, state: JarvisDiagnosticState, detail: string, action?: string): JarvisDiagnosticItem {
  return { code, label, state, detail, ...(action ? { action } : {}) };
}

function serviceItem(
  code: "BROKER" | "GATEWAY",
  label: string,
  value: JarvisSelfDiagnosticInput["broker"],
): JarvisDiagnosticItem {
  if (value === "ready") return item(code, label, "ready", `${label}へ接続できます`);
  if (value === "auth-missing") return item(code, label, "blocked", `${label}の認証設定が不足または拒否されています`, "認証設定を確認してください");
  if (value === "unconfigured") return item(code, label, "blocked", `${label}の接続先が設定されていません`, "接続先設定を確認してください");
  if (value === "unreachable") return item(code, label, "blocked", `${label}へ到達できません`, `${label}プロセスと接続経路を確認してください`);
  return item(code, label, "unknown", `${label}の状態を確認できません`, "接続経路の復旧後に再確認してください");
}

export function buildJarvisSelfDiagnostics(input: JarvisSelfDiagnosticInput): JarvisSelfDiagnosticReport {
  const authMissing = !input.ownerAuthConfigured || !input.brokerAuthConfigured || !input.gatewayAuthConfigured;
  const authDetail = !input.ownerAuthConfigured
    ? "オーナー認証が設定されていません"
    : !input.brokerAuthConfigured || !input.gatewayAuthConfigured
      ? "内部サービス認証の設定が不足しています"
      : "オーナー認証と内部サービス認証が設定されています";

  const build = input.productionBuildPresent === true
    ? item("BUILD", "Production build", "ready", "Production buildを確認しました")
    : input.productionBuildPresent === false
      ? item("BUILD", "Production build", "blocked", "Production buildが見つかりません", "Production buildを作成してから再確認してください")
      : item("BUILD", "Production build", "unknown", "この実行場所からProduction buildを確認できません");

  const tailscale = input.tailscale === "running"
    ? item("TAILSCALE", "Tailscale", "ready", "Tailscale backendはRunningです")
    : input.tailscale === "stopped"
      ? item("TAILSCALE", "Tailscale", "blocked", "Tailscaleが切断されています", "ホスト側でTailscaleの接続状態を確認してください")
      : item("TAILSCALE", "Tailscale", "unknown", "Tailscaleの状態を確認できません。Broker到達不能だけから原因を決めつけません");

  const host = input.hostObserved === true
    ? item("HOST", "JARVIS host", "ready", "JARVIS hostの応答を確認しました")
    : input.hostObserved === false
      ? item("HOST", "JARVIS host", "blocked", "JARVIS hostが応答していません", "ホストの電源・OS・自動起動を確認してください")
      : item("HOST", "JARVIS host", "unknown", "JARVIS hostの生存を独立に確認できません。Broker/Tailscale障害と区別できる証拠がありません");

  let worker: JarvisDiagnosticItem;
  if (input.workerTotal === undefined) {
    worker = item("WORKER", "Worker", "unknown", "Worker一覧を確認できません");
  } else if (input.workerTotal === 0) {
    worker = item("WORKER", "Worker", "blocked", "登録済みWorkerがありません", "Worker登録状態を確認してください");
  } else if ((input.workerReady ?? 0) === 0) {
    worker = item("WORKER", "Worker", "blocked", `Worker ${input.workerTotal}台のうち利用可能な端末がありません（offline ${input.workerOffline ?? 0}台）`, "Workerの接続・状態を確認してください");
  } else {
    worker = item("WORKER", "Worker", "ready", `Worker ${input.workerReady ?? 0}/${input.workerTotal}台が利用可能です（offline ${input.workerOffline ?? 0}台）`);
  }

  let permission: JarvisDiagnosticItem;
  if (!input.devicePermissionBlockers) {
    permission = item("DEVICE_PERMISSION", "Device permission", "unknown", "端末の操作権限を確認できません");
  } else if (input.devicePermissionBlockers.length === 0) {
    permission = item("DEVICE_PERMISSION", "Device permission", "ready", "確認できた端末に操作権限ブロッカーはありません");
  } else {
    const details = input.devicePermissionBlockers.slice(0, 5).join(" / ");
    permission = item("DEVICE_PERMISSION", "Device permission", "blocked", details, "対象端末のロック・自動操作権限・接続許可を確認してください");
  }

  let firmware: JarvisDiagnosticItem;
  if (input.firmwareGate === "verified") {
    firmware = item("FIRMWARE_GATE", "Firmware gate", "ready", "Firmwareの復電設定は証拠で確認済みです");
  } else if (input.firmwareGate === "not-applicable") {
    firmware = item("FIRMWARE_GATE", "Firmware gate", "ready", "このホストではWindows BIOS/UEFI復電ゲートは対象外です");
  } else if (input.firmwareGate === "manual-required") {
    firmware = item("FIRMWARE_GATE", "Firmware gate", "pending", "BIOS/UEFIのAC復電設定はソフトウェアだけでは確認できません", "実機でRestore/After Power Loss設定を確認してください");
  } else {
    firmware = item("FIRMWARE_GATE", "Firmware gate", "unknown", "Firmware復電設定の証拠がありません");
  }

  const humanGate = input.humanGateCount === undefined
    ? item("HUMAN_GATE", "Human Gate", "unknown", "Human Gate待ち件数を確認できません")
    : input.humanGateCount > 0
      ? item("HUMAN_GATE", "Human Gate", "pending", `Human Gate / Takeoverが${input.humanGateCount}件待機しています`, "内容を確認し、必要な人間操作だけを実施してください")
      : item("HUMAN_GATE", "Human Gate", "ready", "待機中のHuman Gateはありません");

  const items: JarvisDiagnosticItem[] = [
    item("AUTH", "Authentication", authMissing ? "blocked" : "ready", authDetail, authMissing ? "認証設定を確認してください" : undefined),
    build,
    tailscale,
    host,
    serviceItem("BROKER", "Broker", input.broker),
    serviceItem("GATEWAY", "Remote Gateway", input.gateway),
    worker,
    permission,
    firmware,
    humanGate,
  ];

  const overall: JarvisDiagnosticState = items.some((entry) => entry.state === "blocked")
    ? "blocked"
    : items.some((entry) => entry.state === "pending")
      ? "pending"
      : items.some((entry) => entry.state === "unknown")
        ? "unknown"
        : "ready";

  return { overall, items };
}

export function diagnosticStateLabel(state: JarvisDiagnosticState): string {
  return labels[state];
}
