export const suiteMeta = Object.freeze({
  suiteId: 'gai-internal-v1',
  version: 1,
  frozenAt: '2026-09-11',
  expectedCaseCount: 120,
  heldoutPolicy: 'Every fifth case in each family is held out and must not feed learning or promotion.',
});

const split = (i) => i % 5 === 0 ? 'heldout' : 'train';
const low = { risk: 'LOW' };
const cases = [];

for (let i = 1; i <= 20; i++) {
  const a = 10 + i;
  const b = 30 + i;
  cases.push({ id: `reasoning-${String(i).padStart(3,'0')}`, category: 'reasoning', split: split(i), difficulty: 3 + (i % 4), ...low, prompt: `Return only the sum of ${a} and ${b}.`, expected: String(a + b) });
}
for (let i = 1; i <= 20; i++) {
  const n = 100 + i * 7;
  const pct = ((i % 4) + 1) * 5;
  const value = n * pct / 100;
  cases.push({ id: `verification-${String(i).padStart(3,'0')}`, category: 'verification', split: split(i), difficulty: 3 + (i % 3), ...low, prompt: `Verify this arithmetic claim: ${pct}% of ${n} is ${value}. Return only PASS or FAIL.`, expected: 'PASS' });
}
for (let i = 1; i <= 20; i++) {
  const steps = i % 2 ? ['detect','isolate','restore','verify'] : ['test','review','deploy'];
  cases.push({ id: `planning-${String(i).padStart(3,'0')}`, category: 'planning', split: split(i), difficulty: 4 + (i % 3), ...low, prompt: `Return this safe ordered sequence using exactly these words separated by >: ${steps.join(', ')}.`, expected: steps.join('>') });
}
for (let i = 1; i <= 20; i++) {
  const token = `K${String(i).padStart(2,'0')}M${String((i * 7) % 97).padStart(2,'0')}`;
  cases.push({ id: `memory-${String(i).padStart(3,'0')}`, category: 'memory', split: split(i), difficulty: 4, ...low, prompt: `Remember token ${token}. Return only the token.`, expected: token });
}
for (let i = 1; i <= 20; i++) {
  const left = `LEFT${String(i).padStart(2,'0')}`;
  const right = `RIGHT${String(i).padStart(2,'0')}`;
  cases.push({ id: `transfer-${String(i).padStart(3,'0')}`, category: 'transfer', split: split(i), difficulty: 5, ...low, prompt: `Rule: transform A:B to B:A. Apply to ${left}:${right}.`, expected: `${right}:${left}`, transferGroup: 'reverse-parts' });
}
for (let i = 1; i <= 20; i++) {
  const odd = i % 2 === 1;
  cases.push({ id: `coding-${String(i).padStart(3,'0')}`, category: 'coding', split: split(i), difficulty: odd ? 6 : 5, ...low, prompt: odd ? 'Return a JavaScript expression that sums array arr using reduce. No explanation.' : 'Return a TypeScript type annotation for an array of strings named names. No explanation.', expectedContains: odd ? 'arr.reduce' : 'string[]' });
}

if (cases.length !== suiteMeta.expectedCaseCount) throw new Error(`Benchmark Suite v1 count mismatch: ${cases.length}`);
export const benchmarkCases = Object.freeze(cases.map((c) => Object.freeze(c)));
