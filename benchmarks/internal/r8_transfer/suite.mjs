import crypto from 'node:crypto';

export const suiteMeta = Object.freeze({
  suiteId: 'gai-r8-memory-transfer-v1',
  version: '1.0',
  frozenAt: '2026-09-12',
  heldoutPolicy: 'Only train exemplars may enter the memory prompt. Heldout inputs and answers are evaluation-only.',
});

const families = [
  {
    id: 'amber',
    apply: (value) => value.split('').reverse().join('').toUpperCase(),
    train: ['ab3k','m7pq','t2rx','c9nv','h4sd'],
    heldout: ['j6wf','p3lz','r8ct','v5gm','x2bk'],
  },
  {
    id: 'birch',
    apply: (value) => {
      const [a,b] = value.split(':');
      return `${b.toLowerCase()}:${a.toUpperCase()}`;
    },
    train: ['ka:MO','ri:ZEN','to:LUX','mi:QAR','su:VEX'],
    heldout: ['na:POL','fi:RUM','ge:TAK','yo:BIS','wu:NEX'],
  },
  {
    id: 'cobalt',
    apply: (value) => {
      const parts = value.split('-');
      return `${parts[1]}${parts[0]}${parts[1]}`;
    },
    train: ['A1-B2','C3-D4','E5-F6','G7-H8','J9-K0'],
    heldout: ['L2-M3','N4-P5','Q6-R7','S8-T9','U1-V2'],
  },
  {
    id: 'dune',
    apply: (value) => value.split('').map((ch, i) => i % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase()).join(''),
    train: ['orbit','signal','vector','memory','planet'],
    heldout: ['kernel','bridge','canyon','silver','tensor'],
  },
];

const fingerprint = (text) => crypto.createHash('sha256').update(text).digest('hex');
export const transferFamilies = Object.freeze(families.map((family) => Object.freeze({
  id: family.id,
  train: Object.freeze(family.train.map((input, index) => Object.freeze({
    id: `${family.id}-train-${index + 1}`,
    input,
    output: family.apply(input),
    fingerprint: fingerprint(`${family.id}|train|${input}|${family.apply(input)}`),
  }))),
  heldout: Object.freeze(family.heldout.map((input, index) => Object.freeze({
    id: `${family.id}-heldout-${index + 1}`,
    input,
    output: family.apply(input),
    fingerprint: fingerprint(`${family.id}|heldout|${input}|${family.apply(input)}`),
  }))),
}))));

if (transferFamilies.some((family) => family.train.length < 4 || family.heldout.length < 4)) throw new Error('R8 transfer suite requires >=4 train and >=4 heldout cases per family');
