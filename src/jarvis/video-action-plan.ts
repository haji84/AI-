import { createHash } from 'node:crypto';
import type { Observation, TeachingAdapter, TeachingStore } from './teaching.ts';
import { profileKey } from './teaching.ts';

export type VideoActionPlan = { goal: string; completion: string; steps: Array<{ label: string; before: string; after: string }> };
const navigation = /^(戻る|ホーム|次へ|前へ|開く|一覧|詳細|検索|閉じる|Back|Home|Next|Previous|Open|Details|Search|Close)$/i;
function description(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 300 || /password|token|secret|パスワード|秘密鍵/i.test(value)) throw Error('Invalid video description');
  return value.trim();
}
export function validateVideoActionPlan(input: unknown): VideoActionPlan {
  const p = input as VideoActionPlan & { uncertain?: boolean };
  if (!p || p.uncertain !== false || !Array.isArray(p.steps) || !p.steps.length || p.steps.length > 12) throw Error('録画から操作を確定できません。実演記録またはHuman Takeoverが必要です');
  return { goal: description(p.goal), completion: description(p.completion), steps: p.steps.map(s => {
    if (!s || typeof s.label !== 'string' || !navigation.test(s.label)) throw Error('この操作は現在の自動再現範囲外です。Human Takeoverが必要です');
    return { label: s.label, before: description(s.before), after: description(s.after) };
  }) };
}
export function groundVideoTarget(observation: Observation, label: string) {
  if (observation.protectedScreen || !navigation.test(label)) throw Error('Human Gate required');
  const hash = createHash('sha256').update(label).digest('hex');
  const targets = observation.targets.filter(t => t.safeNavigation && t.labelHash === hash);
  if (targets.length !== 1) throw Error('操作対象が不明または複数あります。自動操作を停止しました');
  return { kind: 'tap' as const, selector: targets[0].selector };
}
export interface VideoGroundingAdapter extends TeachingAdapter {
  matches(description: string): Promise<boolean>;
}
// This first observed run collects a draft; a separate normal replay must verify it.
export async function groundVideoPlan(plan: VideoActionPlan, store: TeachingStore, adapter: VideoGroundingAdapter, sessionId: string) {
  await adapter.authorize();
  const initial = await adapter.observe();
  if (initial.profile.platform !== 'android' || initial.protectedScreen || Object.values(initial.profile).includes('unknown')) throw Error('対応端末の安全な開始画面と既知のアプリ版が必要です');
  const variant = store.start({ goal: plan.goal, scope: 'device', profile: initial.profile, sessionId });
  const deadline = Date.now() + 5 * 60000;
  try {
    for (const step of plan.steps) {
      if (Date.now() > deadline) throw Error('動画再現の制限時間です');
      await adapter.authorize();
      const before = await adapter.observe();
      if (before.profile.deviceId !== initial.profile.deviceId || before.protectedScreen) throw Error('Device changed or Human Gate');
      if (!await adapter.matches(step.before)) throw Error('録画の開始画面と実機が一致しません');
      const current = await adapter.observe();
      if (current.signature !== before.signature || profileKey(current.profile) !== profileKey(before.profile)) throw Error('操作前に画面が変化しました');
      const action = groundVideoTarget(current, step.label);
      await adapter.authorize();
      await adapter.execute(action, current);
      const after = await adapter.observe();
      if (after.protectedScreen || after.profile.deviceId !== initial.profile.deviceId || !await adapter.matches(step.after)) throw Error('操作後の画面が一致しません。入力は再送しません');
      const stable = await adapter.observe();
      if (stable.signature !== after.signature || profileKey(stable.profile) !== profileKey(after.profile)) throw Error('確認中に画面が変化しました');
      store.append(variant.id, { action, before: before.signature, after: after.signature, contextKey: profileKey(before.profile), gate: false });
    }
    const final = await adapter.observe();
    if (final.protectedScreen || !await adapter.matches(plan.completion)) throw Error('完了画面を確認できません');
    await adapter.authorize();
    const stable = await adapter.observe();
    if (stable.signature !== final.signature || profileKey(stable.profile) !== profileKey(final.profile)) throw Error('完了画面が変化しました');
    return store.finish(variant.id, plan.completion, final.signature);
  } catch (error) { store.cancel(variant.id); throw error; }
}
