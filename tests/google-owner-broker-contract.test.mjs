import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

const broker = readFileSync(new URL("../scripts/jarvis-broker.ts", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/app/google-owner-state-client.ts", import.meta.url), "utf8");

test("Broker owns durable Google Owner identity and one-time enrollment state", () => {
  assert.match(broker, /GoogleOwnerStateRegistry/);
  assert.match(broker, /\/api\/jarvis\/admin\/google-owner/);
  assert.match(broker, /issueContext/);
  assert.match(broker, /consumeContext/);
  assert.match(broker, /bindIdentity/);
});

test("Next server reaches Google Owner state only through authenticated Broker admin API", () => {
  assert.match(client, /jarvisBrokerFetch/);
  assert.match(client, /\/api\/jarvis\/admin\/google-owner/);
  assert.doesNotMatch(client, /JARVIS_OWNER_SECRET/);
});
