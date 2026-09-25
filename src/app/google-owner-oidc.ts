import { createHash, createPublicKey, verify } from "node:crypto";

export type GoogleIdClaims = {
  iss: string;
  aud: string | string[];
  sub: string;
  email?: string;
  email_verified?: boolean;
  iat: number;
  exp: number;
  nonce?: string;
};

type VerifyOptions = {
  clientId: string;
  nonce: string;
  nowSeconds?: number;
  fetchJwks?: () => Promise<{ keys: JsonWebKey[] }>;
};

const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function decodeJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

export async function verifyGoogleIdToken(token: string, options: VerifyOptions): Promise<GoogleIdClaims> {
  const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
  if (extra !== undefined || !headerPart || !payloadPart || !signaturePart) throw new Error("google identity rejected");
  const header = decodeJson<{ alg?: string; kid?: string }>(headerPart);
  const claims = decodeJson<GoogleIdClaims>(payloadPart);
  if (header.alg !== "RS256" || !header.kid) throw new Error("google identity rejected");
  const jwks = await (options.fetchJwks?.() ?? fetchGoogleJwks());
  const jwk = jwks.keys.find(key => (key as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error("google identity rejected");
  const valid = verify(
    "RSA-SHA256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" }),
    Buffer.from(signaturePart, "base64url"),
  );
  if (!valid) throw new Error("google identity rejected");
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!GOOGLE_ISSUERS.has(claims.iss) || !audiences.includes(options.clientId) || claims.exp < now || claims.iat > now + 60 || claims.nonce !== options.nonce || !claims.sub) throw new Error("google identity rejected");
  return claims;
}

async function fetchGoogleJwks(): Promise<{ keys: JsonWebKey[] }> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("google identity unavailable");
  return await response.json() as { keys: JsonWebKey[] };
}

export async function exchangeGoogleAuthorizationCode(input: { code: string; codeVerifier: string; redirectUri: string; clientId: string }): Promise<{ id_token?: string }> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-store" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("google identity unavailable");
  const payload = await response.json() as { id_token?: unknown };
  return typeof payload.id_token === "string" ? { id_token: payload.id_token } : {};
}
