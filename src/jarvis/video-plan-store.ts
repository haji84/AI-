import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { validateVideoActionPlan, type VideoActionPlan } from './video-action-plan.ts';
const root = () => process.env.JARVIS_VIDEO_PLAN_DIR || join(dirname(process.env.JARVIS_TEACHING_PATH || resolve('.jarvis/teaching.json')), 'video-plans');
export function saveVideoPlan(plan: VideoActionPlan, model: string) {
  mkdirSync(root(), { recursive: true });
  if (readdirSync(root()).length >= 500) throw Error('Video plan capacity');
  const id = randomUUID();
  writeFileSync(join(root(), id + '.json'), JSON.stringify({ ...plan, uncertain: false, model, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  return id;
}
export function readVideoPlan(id: string): VideoActionPlan {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid video plan ID');
  const text = readFileSync(join(root(), id + '.json'), 'utf8');
  if (text.length > 20000) throw Error('Invalid plan size');
  return validateVideoActionPlan(JSON.parse(text));
}
