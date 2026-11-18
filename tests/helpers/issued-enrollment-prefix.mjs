// Test-only prefix collision fixture. Other randomness and invitation lengths
// retain their real generators; the counter makes these 24-byte values unique.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { syncBuiltinESMExports } from 'node:module';

const original = crypto.randomBytes;
let sequence = 0;
crypto.randomBytes = function (size, ...args) {
  if (size === 24 && args.length === 0) {
    const suffix = original.call(this, size).toString('base64url').slice(0, 21);
    const value = 'ji_' + (++sequence).toString(36).padStart(8, '0') + suffix;
    return Buffer.from(value, 'base64url');
  }
  return original.call(this, size, ...args);
};
syncBuiltinESMExports();
