"use client";

const DB_NAME = "jarvis-trusted-operator";
const STORE_NAME = "credentials";
const RECORD_KEY = "owner";
const RECOVERY_PENDING_KEY = "jarvis-trusted-operator-recovery-pending";
const PBKDF2_ITERATIONS = 600_000;
const MAX_PIN_FAILURES = 5;
const LOCK_MS = 5 * 60_000;

type StoredTrustedDevice = {
  id: string;
  label: string;
  publicKeyJwk: JsonWebKey;
  encryptedPrivateJwk: string;
  iv: string;
  salt: string;
  credential: string;
  failedAttempts: number;
  lockedUntil: number;
};

type PendingTrustedDevice = Omit<StoredTrustedDevice, "credential" | "failedAttempts" | "lockedUntil">;

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function requirePin(pin: string): void {
  if (!/^\d{4}$/.test(pin)) throw new Error("PINは4桁の数字で入力してください");
}
function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}
async function pinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  requirePin(pin);
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: arrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readRecord(): Promise<StoredTrustedDevice | null> {
  const db = await openDb();
  return new Promise<StoredTrustedDevice | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
    req.onsuccess = () => resolve((req.result as StoredTrustedDevice | undefined) ?? null);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}
async function writeRecord(record: StoredTrustedDevice | null): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    if (record) store.put(record, RECORD_KEY); else store.delete(RECORD_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}
async function decryptPrivate(record: StoredTrustedDevice, pin: string): Promise<JsonWebKey> {
  if (record.lockedUntil > Date.now()) throw new Error("PIN入力が一時ロックされています。少し待って再試行してください");
  try {
    const salt = b64urlToBytes(record.salt);
    const key = await pinKey(pin, salt);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: arrayBuffer(b64urlToBytes(record.iv)) },
      key,
      arrayBuffer(b64urlToBytes(record.encryptedPrivateJwk)),
    );
    if (record.failedAttempts) await writeRecord({ ...record, failedAttempts: 0, lockedUntil: 0 });
    return JSON.parse(new TextDecoder().decode(plain)) as JsonWebKey;
  } catch {
    const failedAttempts = record.failedAttempts + 1;
    const lockedUntil = failedAttempts >= MAX_PIN_FAILURES ? Date.now() + LOCK_MS : 0;
    await writeRecord({ ...record, failedAttempts: failedAttempts >= MAX_PIN_FAILURES ? 0 : failedAttempts, lockedUntil });
    throw new Error(lockedUntil ? "PIN入力を一時ロックしました。5分後に再試行してください" : "PINが違います");
  }
}
async function createEncryptedDevice(pin: string, label: string): Promise<PendingTrustedDevice> {
  requirePin(pin);
  const normalizedLabel = label.trim().slice(0, 80);
  if (!normalizedLabel) throw new Error("端末名を入力してください");
  const id = crypto.randomUUID().replace(/-/g, "_");
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pinKey(pin, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(privateKeyJwk)),
  );
  return {
    id,
    label: normalizedLabel,
    publicKeyJwk,
    encryptedPrivateJwk: bytesToB64url(new Uint8Array(encrypted)),
    iv: bytesToB64url(iv),
    salt: bytesToB64url(salt),
  };
}

export async function hasTrustedDevice(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  const record = await readRecord();
  return Boolean(record?.credential);
}
export async function trustedDeviceInfo(): Promise<{ id: string; label: string } | null> {
  const record = await readRecord();
  return record?.credential ? { id: record.id, label: record.label } : null;
}
export async function enrollTrustedDevice(pin: string, label: string): Promise<void> {
  const pending = await createEncryptedDevice(pin, label);
  const response = await fetch("/api/owner-login/trusted/enroll", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ deviceId: pending.id, label: pending.label, publicKeyJwk: pending.publicKeyJwk }),
  });
  const result = await response.json();
  if (!response.ok || typeof result.credential !== "string") throw new Error(result.message || "信頼済み端末を登録できませんでした");
  await writeRecord({
    ...pending,
    credential: result.credential,
    failedAttempts: 0,
    lockedUntil: 0,
  });
}
export async function createTrustedDeviceRecoveryRequest(pin: string, label: string): Promise<string> {
  if (typeof sessionStorage === "undefined") throw new Error("このブラウザでは復旧登録を利用できません");
  const pending = await createEncryptedDevice(pin, label);
  sessionStorage.setItem(RECOVERY_PENDING_KEY, JSON.stringify(pending));
  const request = {
    deviceId: pending.id,
    label: pending.label,
    publicKeyJwk: pending.publicKeyJwk,
  };
  return `tqr1.${bytesToB64url(new TextEncoder().encode(JSON.stringify(request)))}`;
}
export async function completeTrustedDeviceRecovery(grant: string): Promise<void> {
  if (typeof sessionStorage === "undefined") throw new Error("このブラウザでは復旧登録を利用できません");
  const raw = sessionStorage.getItem(RECOVERY_PENDING_KEY);
  if (!raw) throw new Error("このブラウザの復旧要求がありません。要求コードを作り直してください");
  const pending = JSON.parse(raw) as PendingTrustedDevice;
  const response = await fetch("/api/owner-login/trusted/recover-enroll", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant: grant.trim() }),
  });
  const result = await response.json();
  if (!response.ok || typeof result.credential !== "string" || result.deviceId !== pending.id) {
    throw new Error(result.message || "復旧登録の承認を確認できませんでした");
  }
  await writeRecord({
    ...pending,
    credential: result.credential,
    failedAttempts: 0,
    lockedUntil: 0,
  });
  sessionStorage.removeItem(RECOVERY_PENDING_KEY);
}
export async function changeTrustedDevicePin(currentPin: string, nextPin: string): Promise<void> {
  requirePin(nextPin);
  const record = await readRecord();
  if (!record?.credential) throw new Error("この端末はまだ信頼済み端末ではありません");
  const privateKeyJwk = await decryptPrivate(record, currentPin);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pinKey(nextPin, salt);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: arrayBuffer(iv) }, key, new TextEncoder().encode(JSON.stringify(privateKeyJwk)));
  await writeRecord({
    ...record,
    encryptedPrivateJwk: bytesToB64url(new Uint8Array(encrypted)),
    iv: bytesToB64url(iv),
    salt: bytesToB64url(salt),
    failedAttempts: 0,
    lockedUntil: 0,
  });
}
export async function removeTrustedDevice(): Promise<void> {
  await writeRecord(null);
}
export async function signInWithTrustedPin(pin: string): Promise<void> {
  const record = await readRecord();
  if (!record?.credential) throw new Error("この端末は信頼済み登録されていません");
  const privateKeyJwk = await decryptPrivate(record, pin);
  const challengeResponse = await fetch("/api/owner-login/trusted/challenge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ credential: record.credential }),
  });
  const challenge = await challengeResponse.json();
  if (!challengeResponse.ok || typeof challenge.nonce !== "string" || typeof challenge.token !== "string") {
    throw new Error(challenge.message || "信頼済み端末の確認を開始できませんでした");
  }
  const privateKey = await crypto.subtle.importKey("jwk", privateKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(challenge.nonce));
  const verifyResponse = await fetch("/api/owner-login/trusted/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ credential: record.credential, challengeToken: challenge.token, signatureBase64Url: bytesToB64url(new Uint8Array(signature)) }),
  });
  const verified = await verifyResponse.json();
  if (!verifyResponse.ok || verified.ok !== true) throw new Error(verified.message || "PINログインに失敗しました");
}
