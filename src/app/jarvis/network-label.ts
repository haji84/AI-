/** Worker payloads are runtime data: old workers send text, Android sends an object. */
export function networkLabel(value: unknown): string {
  if (typeof value === "string") return value.trim() || "不明";
  if (value === null || value === undefined) return "-";
  if (typeof value !== "object" || Array.isArray(value)) return "不明";
  const network = value as Record<string, unknown>;
  if (network.connected === false) return "未接続";
  const labels: Record<string, string> = { wifi: "Wi-Fi", cellular: "モバイル回線", ethernet: "有線LAN", lan: "有線LAN", vpn: "VPN", none: "未接続", unknown: "不明", other: "その他" };
  const transport = typeof network.transport === "string" && Object.hasOwn(labels, network.transport) ? labels[network.transport] : "不明";
  return network.validated === false && network.connected === true
    ? `${transport}（インターネット未確認）`
    : transport;
}
