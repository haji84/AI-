export const INVITATION_PAGE = "https://jarvis-fawn-iota.vercel.app/android-join";
export const WORKER_APK = "https://github.com/haji84/AI-/releases/download/jarvis-worker-latest/jarvis-worker.apk";

export function invitationParameters(broker: string, secret: string) {
  const origin = new URL(broker);
  const parts = origin.hostname.split(".").map(Number);
  const privateHost = /^\d+\.\d+\.\d+\.\d+$/.test(origin.hostname) && parts.every(x => x >= 0 && x <= 255)
    && (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  if (!privateHost || origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
    || !/^ji_[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("無効な登録リンクです");
  return new URLSearchParams({ broker: origin.origin, token: secret }).toString();
}
export function invitationUrl(broker: string, secret: string) { return `${INVITATION_PAGE}#${invitationParameters(broker, secret)}`; }
export function invitationIntent(fragment: string) {
  const input = new URLSearchParams(fragment.replace(/^#/, ""));
  const params = invitationParameters(input.get("broker") || "", input.get("token") || "");
  return `intent://enroll?${params}#Intent;scheme=jarvis;package=ai.jarvis.worker;end`;
}
