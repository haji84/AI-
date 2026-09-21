import type { RecoveryCodeDelivery } from "./owner-recovery-store.ts";

function configuredEndpoint(): URL {
  const raw = process.env.JARVIS_RECOVERY_MAIL_WEBHOOK_URL?.trim() || "";
  if (!raw) throw new Error("recovery mail transport is not configured");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("recovery mail webhook must be HTTPS without embedded credentials");
  return url;
}

export const deliverOwnerRecoveryCode: RecoveryCodeDelivery = async ({ address, code, purpose, expiresAt }) => {
  const endpoint = configuredEndpoint();
  const bearer = process.env.JARVIS_RECOVERY_MAIL_WEBHOOK_TOKEN?.trim() || "";
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({
      to: address,
      template: purpose === "register" ? "jarvis-recovery-email-confirmation" : "jarvis-owner-recovery",
      code,
      expiresAt,
    }),
  });
  if (!response.ok) throw new Error(`recovery mail delivery failed: HTTP ${response.status}`);
};
