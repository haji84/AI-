#!/usr/bin/env node
import process from 'node:process';
import { inspectFriendActivation } from '../src/remote-lite/friend-activation-readiness.mjs';

// Intentionally read-only. No account/key generation, listener, network call,
// operating-system change, friend invitation or GORIQ core service mutation.
if (process.argv.length !== 3) {
  process.stderr.write('Usage: node scripts/remote-lite-friend-activation-check.mjs <approved-private-wrapper-path>\n');
  process.exitCode = 2;
} else {
  const result = inspectFriendActivation(process.argv[2]);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.configured) process.exitCode = 2;
}
