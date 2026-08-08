import type { PlacedStamp, CustomStamp } from '../../types';

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * Bounding-circle radius for a plan stamp in world coordinates.
 * Uses the larger of width/height as the diameter so the circle
 * fully contains the stamp regardless of aspect ratio.
 */
export function stampRadius(stamp: PlacedStamp, symbol: CustomStamp): number {
  const baseSize = 80;
  const aspect = symbol.naturalWidth / symbol.naturalHeight;
  const w = baseSize * aspect * stamp.manualScale;
  const h = baseSize * stamp.manualScale;
  return Math.max(w, h) * 0.5;
}

/**
 * Union-Find clustering.
 * Groups stamps of the same assetId whose bounding circles overlap
 * into connected components. Only clusters with >1 stamp are returned.
 */
export function buildClusters(
  stamps: PlacedStamp[],
  getSymbol: (id: string) => CustomStamp | undefined
): PlacedStamp[][] {
  // Group by assetId
  const byAsset = new Map<string, PlacedStamp[]>();
  for (const s of stamps) {
    const arr = byAsset.get(s.assetId);
    if (arr) arr.push(s);
    else byAsset.set(s.assetId, [s]);
  }

  const clusters: PlacedStamp[][] = [];

  for (const group of byAsset.values()) {
    if (group.length < 2) continue;

    // Pre-compute radii
    const radii: number[] = [];
    for (const s of group) {
      const sym = getSymbol(s.assetId);
      radii.push(sym ? stampRadius(s, sym) : 40);
    }

    // Union-find
    const parent = Array.from({ length: group.length }, (_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (i: number, j: number) => {
      const ri = find(i), rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    };

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const dx = group[i].x - group[j].x;
        const dy = group[i].y - group[j].y;
        const r = radii[i] + radii[j];
        if (dx * dx + dy * dy < r * r) {
          union(i, j);
        }
      }
    }

    // Collect connected components
    const comps = new Map<number, PlacedStamp[]>();
    for (let i = 0; i < group.length; i++) {
      const root = find(i);
      const arr = comps.get(root);
      if (arr) arr.push(group[i]);
      else comps.set(root, [group[i]]);
    }

    for (const comp of comps.values()) {
      if (comp.length > 1) clusters.push(comp);
    }
  }

  return clusters;
}

export interface RenderedOutline {
  canvas: HTMLCanvasElement;
  offsetX: number;
  offsetY: number;
}

/**
 * Render the outer-only outline of a cluster of overlapping circles.
 *
 * Uses the destination-out trick:
 * 1. Stroke all circles (internal edges also drawn)
 * 2. Erase strokes that lie inside the union by filling all circles
 *    (inset by strokeWidth/2) with destination-out compositing
 * Result: only the outer contour of the union remains.
 */
export function renderClusterOutline(
  circles: Circle[],
  strokeWidth = 6,
  strokeColor = 'rgba(0, 0, 0, 0.75)'
): RenderedOutline {
  if (circles.length === 0) {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    return { canvas: c, offsetX: 0, offsetY: 0 };
  }

  // Bounding box with stroke padding
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of circles) {
    if (c.x - c.r < minX) minX = c.x - c.r;
    if (c.y - c.r < minY) minY = c.y - c.r;
    if (c.x + c.r > maxX) maxX = c.x + c.r;
    if (c.y + c.r > maxY) maxY = c.y + c.r;
  }
  const pad = strokeWidth;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const w = Math.max(1, Math.ceil(maxX - minX));
  const h = Math.max(1, Math.ceil(maxY - minY));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(-minX, -minY);

  // 1. Stroke all circles (all borders, including internal)
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const c of circles) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 2. Erase anything inside the union — fills each circle (slightly inset)
  //    with destination-out, leaving only the outer contour
  ctx.globalCompositeOperation = 'destination-out';
  const inset = strokeWidth / 2;
  for (const c of circles) {
    const innerR = Math.max(0, c.r - inset);
    ctx.beginPath();
    ctx.arc(c.x, c.y, innerR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  return { canvas, offsetX: minX, offsetY: minY };
}
