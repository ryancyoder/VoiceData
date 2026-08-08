import type { PerspectiveConfig } from '../types';

const MIN_RATIO = 0.08;
const MAX_RATIO = 1.5;
const DEFAULT_PLAN_SCALE = 100;

/**
 * Convert photo coordinates to plan (bird's-eye) coordinates.
 *
 * In the photo, Y encodes depth via the perspective ratio.
 * In plan view, we invert this: planY = scale/ratio so that
 * objects near the horizon (small ratio) map to large planY (far away).
 * X is corrected for perspective convergence toward the vanishing point.
 */
export function photoToPlan(
  photoX: number,
  photoY: number,
  perspective: PerspectiveConfig,
  planScale = DEFAULT_PLAN_SCALE
): { planX: number; planY: number } {
  const range = perspective.groundY - perspective.horizonY;
  if (range <= 0) return { planX: photoX, planY: 0 };

  const ratio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, (photoY - perspective.horizonY) / range));

  // Depth: inverse of ratio → further objects get larger planY
  const planY = planScale / ratio;

  // X: undo perspective convergence toward vanishing point
  const photoXRelative = photoX - perspective.vanishingPointX;
  const planX = photoXRelative / ratio;

  return { planX, planY };
}

/**
 * Convert plan (bird's-eye) coordinates back to photo coordinates.
 * Reverse of photoToPlan.
 */
export function planToPhoto(
  planX: number,
  planY: number,
  perspective: PerspectiveConfig,
  planScale = DEFAULT_PLAN_SCALE
): { photoX: number; photoY: number } {
  // Reverse depth mapping
  const ratio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, planScale / planY));
  const range = perspective.groundY - perspective.horizonY;

  const photoY = perspective.horizonY + ratio * range;

  // Reverse X correction
  const photoX = planX * ratio + perspective.vanishingPointX;

  return { photoX, photoY };
}

/**
 * Compute the plan-space canopy radius for a stamp.
 * Uses the stamp's rendered width as a proxy for real-world spread.
 */
export function computeCanopyRadius(
  defaultWidth: number,
  manualScale: number,
  _perspectiveRatio?: number
): number {
  // Base canopy radius in plan units — scaled by manualScale
  return (defaultWidth * manualScale) / 2;
}

/**
 * Compute feet-per-plan-unit from two photo points and a real-world distance.
 */
export function computeFeetPerPlanUnit(
  ref: { point1: { x: number; y: number }; point2: { x: number; y: number }; distanceFt: number },
  perspective: PerspectiveConfig,
  planScale = DEFAULT_PLAN_SCALE
): number {
  const p1 = photoToPlan(ref.point1.x, ref.point1.y, perspective, planScale);
  const p2 = photoToPlan(ref.point2.x, ref.point2.y, perspective, planScale);

  const dist = Math.sqrt((p2.planX - p1.planX) ** 2 + (p2.planY - p1.planY) ** 2);
  if (dist <= 0) return 1;

  return ref.distanceFt / dist;
}

/**
 * Compute the bounding box of all stamps in plan coordinates.
 * Used to auto-fit the plan view viewport.
 */
export function computePlanBounds(
  stamps: { x: number; y: number; manualScale: number; defaultWidth: number }[],
  perspective: PerspectiveConfig,
  planScale = DEFAULT_PLAN_SCALE
): { minX: number; maxX: number; minY: number; maxY: number } {
  if (stamps.length === 0) {
    return { minX: -200, maxX: 200, minY: planScale * 0.5, maxY: planScale * 2 };
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const s of stamps) {
    const { planX, planY } = photoToPlan(s.x, s.y, perspective, planScale);
    const r = computeCanopyRadius(s.defaultWidth, s.manualScale);
    minX = Math.min(minX, planX - r);
    maxX = Math.max(maxX, planX + r);
    minY = Math.min(minY, planY - r);
    maxY = Math.max(maxY, planY + r);
  }

  // Add padding
  const padX = (maxX - minX) * 0.15 + 50;
  const padY = (maxY - minY) * 0.15 + 50;
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

export { DEFAULT_PLAN_SCALE };
