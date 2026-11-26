import test from 'node:test';
import {assertLiteralTrackedRepair} from './helpers/tracked-repair-literal-probe.mjs';

test('tracked model source replacement preserves literal dollar sequences',async()=>{
  await assertLiteralTrackedRepair();
});
