import { pathToFileURL } from 'node:url';

export function assertProductionAuthorizationFresh(expiresAt, now = Date.now()) {
  const expiry = Date.parse(expiresAt ?? '');
  if (!Number.isFinite(expiry) || !Number.isFinite(now) || expiry <= now) {
    throw new Error('PRODUCTION_AUTHORIZATION_EXPIRED');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertProductionAuthorizationFresh(process.env.PRODUCTION_AUTHORIZATION_EXPIRES_AT);
}
