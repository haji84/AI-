import { pkceChallenge, type GoogleIdClaims } from "./google-owner-oidc.ts";
import { publicKeyThumbprint } from "./google-owner-enrollment.ts";

const DEVICE = /^[A-Za-z0-9_-]{16,96}$/;

type BeginInput = { deviceId: string; publicKeyJwk: JsonWebKey; state: string; nonce: string; pkceChallenge: string };
export async function beginGoogleOwnerEnrollment(input: BeginInput, deps: {
  enabled: boolean;
  clientId: string;
  issueContext: (input: { deviceId: string; publicKeyThumbprint: string; state: string; nonce: string; pkceChallenge: string }) => Promise<{ contextId: string; expiresAt: number }>;
}) {
  if (!deps.enabled || !deps.clientId) throw new Error("google owner enrollment unavailable");
  if (!DEVICE.test(input.deviceId) || !input.state || !input.nonce || !input.pkceChallenge) throw new Error("invalid enrollment request");
  const context = await deps.issueContext({
    deviceId: input.deviceId,
    publicKeyThumbprint: publicKeyThumbprint(input.publicKeyJwk),
    state: input.state,
    nonce: input.nonce,
    pkceChallenge: input.pkceChallenge,
  });
  return { ...context, clientId: deps.clientId, authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth" };
}

type CompleteInput = { contextId: string; deviceId: string; publicKeyJwk: JsonWebKey; state: string; nonce: string; code: string; codeVerifier: string; redirectUri: string };
type CompleteDeps = {
  clientId: string;
  bootstrapEmail: string;
  redirectUri: string;
  consumeContext: (input: { contextId: string; deviceId: string; publicKeyThumbprint: string; state: string; nonce: string }) => Promise<{ pkceChallenge: string }>;
  exchangeCode: (input: { code: string; codeVerifier: string; redirectUri: string; clientId: string }) => Promise<{ id_token?: string }>;
  verifyIdToken: (token: string, input: { clientId: string; nonce: string }) => Promise<GoogleIdClaims>;
  bindIdentity: (input: { sub: string; email?: string; emailVerified: boolean; bootstrapEmail: string }) => Promise<unknown>;
  registerDevice: (deviceId: string, label: string) => Promise<unknown>;
  createCredential: (input: { deviceId: string; label: string; publicKeyJwk: JsonWebKey }) => string;
};

export async function completeGoogleOwnerEnrollment(input: CompleteInput, deps: CompleteDeps) {
  if (!DEVICE.test(input.deviceId) || !input.code || !input.codeVerifier || input.redirectUri !== deps.redirectUri) throw new Error("google owner enrollment rejected");
  const context = await deps.consumeContext({
    contextId: input.contextId,
    deviceId: input.deviceId,
    publicKeyThumbprint: publicKeyThumbprint(input.publicKeyJwk),
    state: input.state,
    nonce: input.nonce,
  });
  if (pkceChallenge(input.codeVerifier) !== context.pkceChallenge) throw new Error("google owner enrollment rejected");
  const exchanged = await deps.exchangeCode({ code: input.code, codeVerifier: input.codeVerifier, redirectUri: input.redirectUri, clientId: deps.clientId });
  if (!exchanged.id_token) throw new Error("google owner enrollment rejected");
  const claims = await deps.verifyIdToken(exchanged.id_token, { clientId: deps.clientId, nonce: input.nonce });
  await deps.bindIdentity({ sub: claims.sub, email: claims.email, emailVerified: claims.email_verified === true, bootstrapEmail: deps.bootstrapEmail });
  await deps.registerDevice(input.deviceId, "iPhone Owner");
  return { ok: true, credential: deps.createCredential({ deviceId: input.deviceId, label: "iPhone Owner", publicKeyJwk: input.publicKeyJwk }) };
}
