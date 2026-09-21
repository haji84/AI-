import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = new URL("../scripts/wake-zbook-from-macbook.sh", import.meta.url);
const workflow = new URL("../.github/workflows/zbook-wake-via-macbook.yml", import.meta.url);

test("MacBook ZBook wake helper derives MAC from ARP and fails closed otherwise", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /arp", "-n", ip/);
  assert.match(source, /mac_address_not_found_in_arp_cache/);
  assert.match(source, /SO_BROADCAST/);
  assert.match(source, /255\.255\.255\.255/);
  assert.doesNotMatch(source, /[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}/);
});

test("wake workflow is MacBook-only and issue-triggered", async () => {
  const source = await readFile(workflow, "utf8");
  assert.match(source, /runs-on: \[self-hosted, macOS\]/);
  assert.match(source, /\[JARVIS ZBOOK WAKE\]/);
  assert.match(source, /192\.168\.0\.169/);
});
