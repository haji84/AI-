import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

type Identity = { provider: "google"; sub: string; boundAt: number; version: 1 };
type Context = { contextId: string; deviceId: string; publicKeyThumbprint: string; state: string; nonce: string; pkceChallenge: string; expiresAt: number; consumed: boolean };
type State = { version: 1; identity?: Identity; contexts: Context[] };
const DEVICE_ID = /^[A-Za-z0-9_-]{16,96}$/;

export class GoogleOwnerStateRegistry {
  private readonly path: string;
  constructor(path: string) { this.path = path; }

  private read(): State {
    if (!existsSync(this.path)) return { version: 1, contexts: [] };
    const raw = readFileSync(this.path, "utf8");
    if (raw.length > 131_072) throw new Error("google owner state too large");
    const state = JSON.parse(raw) as State;
    if (state?.version !== 1 || !Array.isArray(state.contexts) || state.contexts.length > 1000) throw new Error("invalid google owner state");
    if (state.identity && (state.identity.provider !== "google" || state.identity.version !== 1 || !state.identity.sub || !Number.isSafeInteger(state.identity.boundAt))) throw new Error("invalid google owner state");
    if (state.contexts.some(item => !item || !item.contextId || !DEVICE_ID.test(item.deviceId) || !item.publicKeyThumbprint || !item.state || !item.nonce || !item.pkceChallenge || !Number.isSafeInteger(item.expiresAt) || typeof item.consumed !== "boolean")) throw new Error("invalid google owner state");
    return state;
  }

  private save(state: State): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomBytes(8).toString("hex")}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(temporary, "wx", 0o600);
      writeFileSync(fd, JSON.stringify(state));
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      renameSync(temporary, this.path);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  identity(): Identity | undefined { return this.read().identity; }

  bindIdentity(input: { sub: string; email?: string; emailVerified: boolean; bootstrapEmail: string }, now = Math.floor(Date.now() / 1000)): Identity {
    const state = this.read();
    if (state.identity) {
      if (state.identity.sub !== input.sub) throw new Error("owner identity rejected");
      return state.identity;
    }
    if (!input.emailVerified || !input.email || input.email.toLowerCase() !== input.bootstrapEmail.trim().toLowerCase() || !input.sub) throw new Error("owner identity rejected");
    state.identity = { provider: "google", sub: input.sub, boundAt: now, version: 1 };
    this.save(state);
    return state.identity;
  }

  issueContext(input: { deviceId: string; publicKeyThumbprint: string; state: string; nonce: string; pkceChallenge: string }, now = Math.floor(Date.now() / 1000)) {
    if (!DEVICE_ID.test(input.deviceId) || !input.publicKeyThumbprint || !input.state || !input.nonce || !input.pkceChallenge) throw new Error("invalid google owner context");
    const state = this.read();
    state.contexts = state.contexts.filter(item => item.expiresAt >= now && !item.consumed).slice(-99);
    const contextId = randomBytes(24).toString("base64url");
    const context = { ...input, contextId, expiresAt: now + 60, consumed: false };
    state.contexts.push(context);
    this.save(state);
    return { contextId, expiresAt: context.expiresAt };
  }

  consumeContext(input: { contextId: string; deviceId: string; publicKeyThumbprint: string; state: string; nonce: string }, now = Math.floor(Date.now() / 1000)) {
    const state = this.read();
    const context = state.contexts.find(item => item.contextId === input.contextId);
    if (!context || context.consumed || context.expiresAt < now || context.deviceId !== input.deviceId || context.publicKeyThumbprint !== input.publicKeyThumbprint || context.state !== input.state || context.nonce !== input.nonce) throw new Error("enrollment context rejected");
    context.consumed = true;
    this.save(state);
    return { ...context };
  }
}
