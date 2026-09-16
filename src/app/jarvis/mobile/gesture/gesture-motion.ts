export type GestureDirection = "left" | "right" | "up" | "down";

export type MotionPoint = {
  x: number;
  y: number;
  at: number;
};

export type GestureCandidate = {
  direction: GestureDirection;
  distance: number;
  durationMs: number;
};

const MIN_POINTS = 3;
const MIN_DISTANCE = 0.18;
const MAX_DURATION_MS = 1_200;
const AXIS_DOMINANCE = 1.35;

export function classifyMotionGesture(points: MotionPoint[]): GestureCandidate | null {
  if (points.length < MIN_POINTS) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const durationMs = last.at - first.at;
  if (durationMs <= 0 || durationMs > MAX_DURATION_MS) return null;

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const distance = Math.hypot(dx, dy);
  if (distance < MIN_DISTANCE) return null;

  if (absX >= absY * AXIS_DOMINANCE) {
    return { direction: dx > 0 ? "right" : "left", distance, durationMs };
  }
  if (absY >= absX * AXIS_DOMINANCE) {
    return { direction: dy > 0 ? "down" : "up", distance, durationMs };
  }
  return null;
}

export function nextTargetIndex(currentIndex: number, direction: GestureDirection, targetCount: number): number {
  if (!Number.isInteger(targetCount) || targetCount <= 0) return 0;
  const normalized = Math.min(Math.max(Number.isInteger(currentIndex) ? currentIndex : 0, 0), targetCount - 1);
  const delta = direction === "left" || direction === "up" ? -1 : 1;
  return (normalized + delta + targetCount) % targetCount;
}

export function canAcceptGestureCandidate(lastAcceptedAt: number, now: number, cooldownMs = 1_000): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(lastAcceptedAt)) return false;
  if (cooldownMs < 0) return false;
  return now - lastAcceptedAt >= cooldownMs;
}

export function trimMotionWindow(points: MotionPoint[], now: number, windowMs = 900): MotionPoint[] {
  if (!Number.isFinite(now) || windowMs <= 0) return [];
  return points.filter((point) => Number.isFinite(point.at) && now - point.at <= windowMs);
}
