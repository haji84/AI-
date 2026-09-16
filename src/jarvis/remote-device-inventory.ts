import type { JarvisNode } from "./types.ts";
import type { JarvisRemoteAssistCapability } from "./remote-assist.ts";

export interface RemoteInventoryDevice {
  serial: string;
  state: string;
  label: string;
  transport: "adb" | "worker";
  remoteAssistCapability: JarvisRemoteAssistCapability | null;
  reason: string;
}

/** Registration is visible independently of the ADB gateway. Never infer a
 * native control transport from an accessibility or generic capability flag. */
export function remoteDeviceInventory(
  fleet: JarvisNode[], adb: { serial: string; state: string }[], now = Date.now(),
): RemoteInventoryDevice[] {
  return [
    ...adb.map((device): RemoteInventoryDevice => ({
      ...device, label: `${device.serial} · USB / ADB`, transport: "adb",
      remoteAssistCapability: device.state === "device" ? "CONTROLLABLE" : null,
      reason: device.state === "device" ? "USB / ADBで操作できます" : "USB / ADBの接続・端末側の許可を確認してください",
    })),
    ...fleet.map((node): RemoteInventoryDevice => {
      const version = typeof node.telemetry?.workerVersion === "string" && /^[0-9.]{1,24}$/.test(node.telemetry.workerVersion) ? `Worker ${node.telemetry.workerVersion}` : "Worker版不明";
      const seen = Date.parse(node.lastSeenAt);
      const offline = !Number.isFinite(seen) || now - seen > 90_000 || now < seen - 30_000 || node.status === "offline";
      const available = !offline && node.kind === "android" && node.status === "ready" && !node.telemetry?.locked && node.telemetry?.remoteProtocol === 1 && node.telemetry?.accessibilityEnabled === true && node.policy.allowRemoteControl && node.capabilities.includes("remote-view") && node.capabilities.includes("remote-control");
      const reason = available ? "Wi-Fiで画面確認・タップ・文字入力・スワイプ・戻る／ホームを操作できます"
        : offline ? "登録済み・未接続。家のWi-FiにつないでWorkerを開いてください（再登録不要）"
        : node.status === "disabled" ? "この端末は無効化されています"
        : node.telemetry?.locked || node.status === "locked" ? "登録済み。端末のロックを解除してください"
        : !node.telemetry?.accessibilityEnabled ? "登録済み。端末のWorkerで「自動操作を有効化」を押してください"
        : node.status !== "ready" ? "別の作業を実行中、または端末の確認が必要です"
        : node.telemetry?.androidApi !== undefined && node.telemetry.androidApi < 30 ? "このOSではWi-Fi画面取得に未対応です。USB / ADBで操作できます"
        : node.telemetry?.remoteProtocol !== 1 ? `${version}：Wi-Fi操作には0.4.3以降への更新が必要です。再インストール後も版が変わらない場合は新版が未配信です（再登録不要）`
        : "登録・接続済み。操作権限・対応機能を確認してください（再登録不要）";
      return { serial: `worker:${node.id}`, label: node.label || node.id,
        state: offline ? "offline" : node.status, transport: "worker", remoteAssistCapability: available ? "CONTROLLABLE" : null, reason: `${reason} / ${version}${typeof node.telemetry?.updateStatus === "string" ? " / " + node.telemetry.updateStatus.slice(0, 200) : ""}` };
    }),
  ];
}
