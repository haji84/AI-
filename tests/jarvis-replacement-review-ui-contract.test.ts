import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const actionRoute = readFileSync(new URL("../src/app/api/jarvis/action/route.ts", import.meta.url), "utf8");
const enrollPage = readFileSync(new URL("../src/app/jarvis/enroll/page.tsx", import.meta.url), "utf8");

test("replacement review proxy is owner-authenticated and exposes only review/discard actions", () => {
  const ownerGate = actionRoute.indexOf("requireJarvisOwner()");
  const readyAction = actionRoute.indexOf('payload.action === "replacement-ready"', ownerGate);
  const discardAction = actionRoute.indexOf('payload.action === "replacement-discard"', ownerGate);
  assert(ownerGate >= 0 && readyAction > ownerGate && discardAction > ownerGate);
  assert.match(actionRoute, /safeReplacementReady/);
  assert.match(actionRoute, /publicKeyFingerprint/);
  assert.doesNotMatch(actionRoute, /action:\s*"replacement-(approve|commit|rebind|revoke)"/);
});

test("replacement review sanitizes Broker public-key material before it reaches the client", () => {
  const sanitizerStart = actionRoute.indexOf("function safeReplacementReady");
  const handlerStart = actionRoute.indexOf("export async function POST", sanitizerStart);
  const sanitizer = actionRoute.slice(sanitizerStart, handlerStart);
  assert.match(sanitizer, /candidateId/);
  assert.match(sanitizer, /nodeId/);
  assert.match(sanitizer, /publicKeyFingerprint/);
  assert.match(sanitizer, /READY_FOR_HUMAN_GATE/);
  assert.doesNotMatch(sanitizer, /publicKeyPem/);
});

test("enrollment UI labels replacement as Human Gate and offers discard but no approval", () => {
  assert.match(enrollPage, /交換端末の本人確認待ち/);
  assert.match(enrollPage, /Human Gate required/);
  assert.match(enrollPage, /交換候補を破棄/);
  assert.match(enrollPage, /旧Identityの失効・新Identityの登録は資格情報を変更するため、別のHuman Gateが必要/);
  assert.doesNotMatch(enrollPage, /交換を承認|approve replacement|replacement-approve|replacement-commit|replacement-rebind|replacement-revoke/i);
});
