import fs from 'node:fs';
import { validateProductionConfig } from './jarvis-production-config.mjs';
try {
  validateProductionConfig(JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '')), process.argv[2]);
  console.log('Production configuration structure: PASS');
} catch { console.error('Production configuration invalid'); process.exitCode = 1; }
