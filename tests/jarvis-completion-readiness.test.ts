import assert from 'node:assert/strict';
import test from 'node:test';
import { JarvisCompletionRuntime } from '../src/jarvis/completion-runtime.ts';

test('instantiating completion engines is not execution-path readiness', () => {
  const runtime = new JarvisCompletionRuntime();
  assert.equal(Object.keys(runtime.softwareReadiness()).length, 16);
  for (const [name, ready] of Object.entries(runtime.softwareReadiness())) {
    assert.equal(ready, false, `${name} has no verified aggregate execution binding`);
  }
});

test('readiness details disclose software gaps separately from physical acceptance', () => {
  const runtime = new JarvisCompletionRuntime();
  const report = runtime.integrationReadiness();
  assert.equal(report.productComplete, false);
  assert.equal(report.physicalAcceptance, 'NOT_EVALUATED');
  for (const [name, entry] of Object.entries(report.engines)) {
    assert.equal(entry.componentAvailable, true, name);
    assert.equal(entry.integrationStatus, 'UNWIRED', name);
    assert.equal(entry.executionEntryPoints.length, 0, name);
    assert.ok(entry.nextAction.length > 20, name);
  }
  report.engines.coordinator.executionEntryPoints.push('fabricated');
  assert.deepEqual(runtime.integrationReadiness().engines.coordinator.executionEntryPoints, []);
});
