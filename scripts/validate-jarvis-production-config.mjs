import fs from 'node:fs';
import { validateProductionConfig } from './jarvis-production-config.mjs';
import { assertWindowsServicePaths } from './jarvis-windows-install-paths.mjs';
try {
  const config = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  validateProductionConfig(config, process.argv[2]);
  if (process.argv[3]) assertWindowsServicePaths(process.argv[2], process.argv[3], config.environment);
  console.log('Production configuration structure: PASS');
} catch { console.error('Production configuration invalid'); process.exitCode = 1; }
