import type { StampAsset } from '../types';

// Built-in stamp assets removed — users upload their own.
// This file is kept for the utility functions used by PlantStamp rendering.

export const STAMP_ASSETS: StampAsset[] = [];

/**
 * Render a stamp asset to an offscreen canvas.
 * Only used for built-in SVG stamps (now empty).
 */
export function renderStampToCanvas(asset: StampAsset, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const scaleX = width / 100;
  const scaleY = height / 100;
  ctx.scale(scaleX, scaleY);

  const path = new Path2D(asset.svgPath);
  ctx.fillStyle = asset.colors[0];
  ctx.fill(path);
  ctx.strokeStyle = asset.colors.length > 1 ? asset.colors[1] : asset.colors[0];
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);

  return canvas;
}

export function getAssetsByCategory(category: string): StampAsset[] {
  return STAMP_ASSETS.filter(a => a.category === category);
}

export function getAssetById(id: string): StampAsset | undefined {
  return STAMP_ASSETS.find(a => a.id === id);
}
