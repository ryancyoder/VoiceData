import type { PerspectiveConfig, CalibrationRef } from '../types';

/**
 * Calculate the perspective scale factor for a stamp based on its vertical
 * position relative to the horizon line.
 *
 * If a calibration reference (person silhouette) is set, we use it to derive
 * the exact baseScale. The calibration tells us: "a person who is realHeightFt
 * tall appears as heightPx pixels when standing at position Y." From this we
 * can compute the correct pixel size for any object at any Y position.
 *
 * The core perspective relationship (linear in image space):
 *   apparentSize ∝ (y - horizonY) / (groundY - horizonY)
 *
 * With calibration, we solve for the proportionality constant so that
 * a stamp with defaultHeight=100px and a known real-world height renders
 * at the correct pixel size at any position.
 */
export function calculateScale(
  stampBottomY: number,
  config: PerspectiveConfig
): number {
  const { horizonY, groundY, baseScale } = config;
  const range = groundY - horizonY;

  if (range <= 0) return baseScale;

  const distFromHorizon = stampBottomY - horizonY;
  const ratio = Math.max(0.08, Math.min(1.5, distFromHorizon / range));
  return ratio * baseScale;
}

/**
 * Compute baseScale from a calibration reference.
 *
 * The calibration person is at position (calY) with feet on the ground,
 * appearing as heightPx pixels tall. A stamp's defaultHeight is ~100px.
 *
 * At the calibration position, the perspective ratio is:
 *   calRatio = (calY - horizonY) / (groundY - horizonY)
 *
 * The rendered height of a stamp at that position is:
 *   renderedHeight = defaultHeight * calRatio * baseScale
 *
 * We want a 5.75ft person (heightPx) to match. So for a generic stamp
 * with defaultHeight=100 representing a "unit" object:
 *   baseScale = heightPx / (100 * calRatio)
 *
 * Then any stamp with a known real-world height relative to a person
 * (e.g., a 30ft oak = ~5.2x a person) gets manualScale = realHeight / personHeight.
 */
export function computeBaseScaleFromCalibration(
  calibration: CalibrationRef,
  horizonY: number,
  groundY: number
): number {
  const range = groundY - horizonY;
  if (range <= 0) return 1;

  const calRatio = (calibration.y - horizonY) / range;
  const clampedRatio = Math.max(0.08, calRatio);

  // heightPx is how tall the person silhouette is at that position.
  // We want a stamp with defaultHeight=100 to render at the person's
  // pixel height when placed at the same Y position.
  // So: 100 * clampedRatio * baseScale = heightPx
  const baseScale = calibration.heightPx / (100 * clampedRatio);

  return Math.max(0.5, baseScale);
}

/**
 * For real-world-height-aware stamps: given a stamp's real height in feet
 * and the calibration person's height, compute the manualScale multiplier.
 *
 * E.g., a 30ft oak tree / 5.75ft person = 5.2x scale multiplier.
 * This is applied ON TOP of the perspective scale.
 */
export function realHeightToManualScale(
  stampRealHeightFt: number,
  personHeightFt: number
): number {
  return stampRealHeightFt / personHeightFt;
}

/**
 * Given a stamp's center Y position and its unscaled height,
 * compute the bottom Y (anchor point for perspective).
 */
export function getStampBottomY(centerY: number, unscaledHeight: number, currentScale: number): number {
  return centerY + (unscaledHeight * currentScale) / 2;
}

/**
 * Create default perspective config for a given canvas/image size.
 * Places horizon at 1/3 from top, ground at bottom.
 * No calibration by default — user sets it with the person tool.
 */
export function createDefaultPerspective(canvasWidth: number, canvasHeight: number): PerspectiveConfig {
  // A stamp's defaultHeight is ~100px. At ground level (ratio=1.0),
  // we want stamps to appear at ~35% of image height — big enough to
  // be clearly visible and realistic for a tree in a front yard photo.
  const baseScale = Math.max(1, (canvasHeight * 0.35) / 100);

  return {
    horizonY: canvasHeight * 0.33,
    groundY: canvasHeight,
    vanishingPointX: canvasWidth / 2,
    baseScale,
    calibration: null,
  };
}
