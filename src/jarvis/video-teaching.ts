export type VideoTeachingMarker = {
  id: string;
  seconds: number;
  instruction: string;
  confirmed: boolean;
};
export const VIDEO_MAX_BYTES = 512 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 3 * 60 * 60;
export const VIDEO_MAX_MARKERS = 50;

export function videoSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > VIDEO_MAX_SECONDS) {
    throw Error('動画は3時間以内の再生可能なファイルを選んでください');
  }
  const count = Math.min(120, Math.max(2, Math.ceil(duration / 2)));
  return Array.from({ length: count }, (_, i) => i * Math.max(0, duration - 0.05) / (count - 1));
}

export function frameDifference(before: Uint8ClampedArray, after: Uint8ClampedArray): number {
  if (!before.length || before.length !== after.length || before.length % 4 !== 0) throw Error('Invalid frame dimensions');
  let delta = 0;
  for (let i = 0; i < before.length; i += 4) {
    delta += Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
  }
  return delta / (before.length / 4 * 3 * 255);
}

export function videoTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  return `${Math.floor(total / 3600).toString().padStart(2, '0')}:${Math.floor(total / 60) % 60 < 10 ? '0' : ''}${Math.floor(total / 60) % 60}:${(total % 60).toString().padStart(2, '0')}`;
}

export function videoInstructions(markers: VideoTeachingMarker[]): string {
  if (!markers.length || markers.length > VIDEO_MAX_MARKERS) throw Error('1〜50件の手順が必要です');
  return [...markers].sort((a, b) => a.seconds - b.seconds).map(marker => {
    if (!Number.isFinite(marker.seconds) || marker.seconds < 0 || marker.seconds > VIDEO_MAX_SECONDS ||
        !marker.confirmed || !marker.instruction.trim() || marker.instruction.length > 320 || /[\r\n]/.test(marker.instruction)) {
      throw Error('各候補に1行の操作説明を入力し、内容を確認してください');
    }
    if (/password|token|secret|パスワード|秘密鍵/i.test(marker.instruction)) throw Error('認証情報を手順に保存しないでください');
    return `[動画 ${videoTimestamp(marker.seconds)}] ${marker.instruction.trim()}`;
  }).join('\n');
}
