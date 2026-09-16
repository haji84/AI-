export type ScreenGeometry = { left: number; top: number; width: number; height: number; nativeWidth: number; nativeHeight: number };
export type ScreenPoint = { x: number; y: number };
export type ScreenInput = { action: "tap"; x: number; y: number } | { action: "swipe"; x1: number; y1: number; x2: number; y2: number; durationMs: number };

export function screenPoint(point: ScreenPoint, geometry: ScreenGeometry): ScreenPoint | null {
  if (!Object.values(geometry).every(Number.isFinite) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const { left, top, width, height, nativeWidth, nativeHeight } = geometry;
  if (width <= 0 || height <= 0 || !Number.isInteger(nativeWidth) || !Number.isInteger(nativeHeight) || nativeWidth < 1 || nativeHeight < 1 || nativeWidth > 20_000 || nativeHeight > 20_000) return null;
  if (point.x < left || point.y < top || point.x > left + width || point.y > top + height) return null;
  return { x: Math.min(nativeWidth - 1, Math.floor((point.x - left) * nativeWidth / width)), y: Math.min(nativeHeight - 1, Math.floor((point.y - top) * nativeHeight / height)) };
}

export function screenGesture(start: ScreenPoint, end: ScreenPoint, geometry: ScreenGeometry, elapsedMs: number): ScreenInput | null {
  const first = screenPoint(start, geometry);
  const last = screenPoint(end, geometry);
  if (!first || !last || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 5_000) return null;
  if (Math.hypot(end.x - start.x, end.y - start.y) < 8) return { action: "tap", ...last };
  return { action: "swipe", x1: first.x, y1: first.y, x2: last.x, y2: last.y, durationMs: Math.max(50, Math.round(elapsedMs)) };
}

export class ScreenGestureTracker {
  private pending: { pointerId: number; point: ScreenPoint; geometry: ScreenGeometry; time: number } | null = null;

  cancel() { this.pending = null; }

  begin(pointerId: number, primary: boolean, point: ScreenPoint, geometry: ScreenGeometry, time: number): boolean {
    if (this.pending || !primary) { this.cancel(); return false; }
    if (!Number.isFinite(time) || !screenPoint(point, geometry)) return false;
    this.pending = { pointerId, point: { ...point }, geometry: { ...geometry }, time };
    return true;
  }

  finish(pointerId: number, point: ScreenPoint, geometry: ScreenGeometry, time: number): ScreenInput | null {
    const pending = this.pending;
    this.cancel();
    if (!pending || pointerId !== pending.pointerId) return null;
    if (Object.keys(geometry).some((key) => geometry[key as keyof ScreenGeometry] !== pending.geometry[key as keyof ScreenGeometry])) return null;
    return screenGesture(pending.point, point, geometry, time - pending.time);
  }
}
