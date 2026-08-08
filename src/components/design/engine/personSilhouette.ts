/**
 * Human figure silhouette for perspective calibration.
 * Rendered as a simple standing person outline on an offscreen canvas.
 * The silhouette is drawn in a 60x150 viewBox (roughly human proportions).
 */

const PERSON_VIEWBOX_W = 60;
const PERSON_VIEWBOX_H = 150;

// SVG path for a standing person silhouette (simplified, recognizable)
const PERSON_PATH =
  // Head
  'M30,0 ' +
  'C22,0 17,5 17,13 C17,21 22,26 30,26 C38,26 43,21 43,13 C43,5 38,0 30,0 Z ' +
  // Neck + shoulders
  'M26,26 L26,32 L10,40 L10,48 L26,42 L26,72 ' +
  // Left leg
  'L18,150 L24,150 L30,85 ' +
  // Right leg
  'L36,150 L42,150 L34,72 ' +
  // Right arm
  'L34,42 L50,48 L50,40 L34,32 L34,26 Z';

const PERSON_COLOR = 'rgba(0, 120, 255, 0.7)';
const PERSON_OUTLINE = 'rgba(0, 80, 200, 0.9)';

/**
 * Render the person silhouette to a canvas at the given pixel dimensions.
 */
export function renderPersonToCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const scaleX = width / PERSON_VIEWBOX_W;
  const scaleY = height / PERSON_VIEWBOX_H;
  ctx.scale(scaleX, scaleY);

  const path = new Path2D(PERSON_PATH);

  ctx.fillStyle = PERSON_COLOR;
  ctx.fill(path);

  ctx.strokeStyle = PERSON_OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke(path);

  return canvas;
}

export { PERSON_VIEWBOX_W, PERSON_VIEWBOX_H };
