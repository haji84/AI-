// Run against a disposable emulator + isolated Broker, never a production fleet.
// fixture JSON: { broker: "http://127.0.0.1:<port>", owner: "<test-only token>" }
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const [fixturePath, nodeId, evidencePath] = process.argv.slice(2);
assert(fixturePath && nodeId && evidencePath, 'Provide fixture JSON, emulator node ID, evidence output');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const origin = new URL(fixture.broker);
assert(origin.hostname === '127.0.0.1' && origin.protocol === 'http:', 'Isolated loopback Broker required');
const headers = { Authorization: `Bearer ${fixture.owner}`, 'Content-Type': 'application/json' };
const sessionId = `static-regression-${Date.now()}`;
const evidence = { nodeId, sessionId, status: 'FAIL', steps: [] };
async function command(input) {
  const start = Date.now();
  const response = await fetch(new URL('/api/jarvis/admin/remote/command', origin), {
    method: 'POST', headers, signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ nodeId, sessionId, expiresAt: start + 8000, input }),
  });
  const result = await response.json();
  evidence.steps.push({ action: input.action, status: response.status, elapsedMs: Date.now() - start,
    capturedAt: result.capturedAt, error: result.error, nativeWidth: result.nativeWidth, nativeHeight: result.nativeHeight });
  assert.equal(response.status, 200, `${input.action}: ${JSON.stringify(result)}`);
  assert.equal(result.ok, true);
  return { result, start };
}
try {
  // No ADB input, animation, or artificial redraw during the captures below.
  await command({ action: 'keyevent', key: 'HOME' });
  await delay(4000);
  for (let i = 0; i < 3; i++) {
    const { result, start } = await command({ action: 'screenshot' });
    assert.equal(result.mimeType, 'image/jpeg');
    assert(result.nativeWidth > 0 && result.nativeHeight > 0);
    assert(Date.parse(result.capturedAt) >= start, 'Capture predates request');
    const bytes = Buffer.from(result.imageBase64, 'base64');
    assert(bytes.length > 100 && bytes.length <= 650000);
    assert.equal(bytes.readUInt16BE(0), 0xffd8, 'JPEG signature');
    assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9, 'Complete JPEG');
    await delay(3000);
  }
  evidence.status = 'PASS';
} finally {
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
}
