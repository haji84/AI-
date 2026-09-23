export type JarvisConnectivityStatus = "online" | "offline" | "reconnecting" | "syncing" | "auth-required";

export type JarvisConnectivityInputs = {
  browserOnline: boolean;
  probe: "idle" | "pending" | "ok" | "failed" | "auth-required";
  reconnecting?: boolean;
};

export function deriveJarvisConnectivityStatus(inputs: JarvisConnectivityInputs): JarvisConnectivityStatus {
  if (!inputs.browserOnline) return "offline";
  if (inputs.probe === "auth-required") return "auth-required";
  if (inputs.reconnecting && inputs.probe !== "ok") return inputs.probe === "pending" ? "syncing" : "reconnecting";
  if (inputs.probe === "pending") return "syncing";
  if (inputs.probe === "failed") return "reconnecting";
  return "online";
}

export function jarvisConnectivityCopy(status: JarvisConnectivityStatus) {
  switch (status) {
    case "offline":
      return { label: "オフライン", detail: "ネットワーク接続を確認してください。" };
    case "reconnecting":
      return { label: "再接続中", detail: "GORIQとの接続復帰を確認しています。" };
    case "syncing":
      return { label: "同期中", detail: "最新のGORIQ状態を読み込んでいます。" };
    case "auth-required":
      return { label: "認証が必要", detail: "ネットワークには接続済みです。状態同期にはオーナー認証が必要です。" };
    default:
      return { label: "オンライン", detail: "GORIQ状態を確認できました。" };
  }
}
