export type ImuPointerStatus = "idle" | "requesting" | "active" | "denied" | "unsupported" | "error";

export type OrientationSample = {
  beta: number | null;
  gamma: number | null;
};

export type OrientationCalibration = {
  beta: number;
  gamma: number;
};

export type PointerPosition = {
  x: number;
  y: number;
};

export const DEFAULT_POINTER_POSITION: PointerPosition = { x: 50, y: 50 };
export const POINTER_DEAD_ZONE_DEGREES = 2;
export const POINTER_MAX_TILT_DEGREES = 20;
export const POINTER_SMOOTHING = 0.25;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeAxis(delta: number): number {
  const magnitude = Math.abs(delta);
  if (magnitude <= POINTER_DEAD_ZONE_DEGREES) return 0;
  const adjusted = Math.sign(delta) * (magnitude - POINTER_DEAD_ZONE_DEGREES);
  const usableRange = POINTER_MAX_TILT_DEGREES - POINTER_DEAD_ZONE_DEGREES;
  return clamp(adjusted / usableRange, -1, 1);
}

export function normalizeOrientationSample(sample: OrientationSample): { beta: number; gamma: number } | null {
  if (!Number.isFinite(sample.beta) || !Number.isFinite(sample.gamma)) return null;
  return {
    beta: clamp(Number(sample.beta), -180, 180),
    gamma: clamp(Number(sample.gamma), -90, 90),
  };
}

export function calibrationFromSample(sample: OrientationSample): OrientationCalibration | null {
  const normalized = normalizeOrientationSample(sample);
  if (!normalized) return null;
  return { beta: normalized.beta, gamma: normalized.gamma };
}

export function projectOrientation(
  sample: OrientationSample,
  calibration: OrientationCalibration,
  previous: PointerPosition = DEFAULT_POINTER_POSITION,
): PointerPosition | null {
  const normalized = normalizeOrientationSample(sample);
  if (!normalized) return null;

  const targetX = 50 + (normalizeAxis(normalized.gamma - calibration.gamma) * 46);
  const targetY = 50 + (normalizeAxis(normalized.beta - calibration.beta) * 46);
  return {
    x: clamp(previous.x + ((targetX - previous.x) * POINTER_SMOOTHING), 4, 96),
    y: clamp(previous.y + ((targetY - previous.y) * POINTER_SMOOTHING), 4, 96),
  };
}

export function nearestPointerTarget(
  position: PointerPosition,
  targets: Array<{ id: string; x: number; y: number }>,
): string | null {
  if (!targets.length) return null;
  let nearest: { id: string; distance: number } | null = null;
  for (const target of targets) {
    const distance = Math.hypot(position.x - target.x, position.y - target.y);
    if (!nearest || distance < nearest.distance) nearest = { id: target.id, distance };
  }
  return nearest?.id ?? null;
}

export function canActivatePointerTarget(status: ImuPointerStatus, selectedTargetId: string | null): boolean {
  return status !== "requesting" && Boolean(selectedTargetId);
}
