import { useEffect, useRef, useState, useCallback } from 'react';
import { Image as KonvaImage, Circle, Line, Group } from 'react-konva';
import { useProjectStore } from '../../store/useProjectStore';
import type { Point2D } from '../../types';

const SUBDIVISIONS = 8;
const ERASER_RADIUS = 30;

type WarpCanvas = HTMLCanvasElement & { _offsetX?: number; _offsetY?: number };

export function PlanOverlay() {
  const planView = useProjectStore((s) => s.planView);
  const setPlanCorners = useProjectStore((s) => s.setPlanCorners);
  const setPlanEraseMask = useProjectStore((s) => s.setPlanEraseMask);
  const toolMode = useProjectStore((s) => s.toolMode);
  const viewMode = useProjectStore((s) => s.viewMode);

  const [planImg, setPlanImg] = useState<HTMLImageElement | null>(null);
  const [warpedCanvas, setWarpedCanvas] = useState<WarpCanvas | null>(null);
  const [displayCanvas, setDisplayCanvas] = useState<WarpCanvas | null>(null);
  const warpCanvasRef = useRef<WarpCanvas | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<WarpCanvas | null>(null);
  const isErasing = useRef(false);

  // Load the cropped selection image (not the full plan)
  useEffect(() => {
    if (!planView.selectionImage) {
      setPlanImg(null);
      setWarpedCanvas(null);
      setDisplayCanvas(null);
      return;
    }
    const img = new window.Image();
    img.src = planView.selectionImage;
    img.onload = () => setPlanImg(img);
  }, [planView.selectionImage]);

  // Create offscreen canvases
  useEffect(() => {
    if (!warpCanvasRef.current) warpCanvasRef.current = document.createElement('canvas') as WarpCanvas;
    if (!maskCanvasRef.current) maskCanvasRef.current = document.createElement('canvas');
    if (!displayCanvasRef.current) displayCanvasRef.current = document.createElement('canvas') as WarpCanvas;
  }, []);

  // Load existing erase mask from store
  useEffect(() => {
    if (!planView.eraseMask || !maskCanvasRef.current) return;
    const img = new window.Image();
    img.onload = () => {
      const mc = maskCanvasRef.current!;
      mc.width = img.naturalWidth;
      mc.height = img.naturalHeight;
      mc.getContext('2d')!.drawImage(img, 0, 0);
    };
    img.src = planView.eraseMask;
  }, [planView.eraseMask]);

  // Re-render warped image whenever corners or plan image change
  useEffect(() => {
    if (!planImg || !planView.corners || !warpCanvasRef.current) {
      setWarpedCanvas(null);
      setDisplayCanvas(null);
      return;
    }

    const canvas = warpCanvasRef.current;
    const corners = planView.corners;

    const minX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
    const maxX = Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
    const minY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
    const maxY = Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y);

    const w = Math.ceil(maxX - minX) || 1;
    const h = Math.ceil(maxY - minY) || 1;

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);

    const c = corners.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    const sw = planImg.naturalWidth;
    const sh = planImg.naturalHeight;

    for (let row = 0; row < SUBDIVISIONS; row++) {
      for (let col = 0; col < SUBDIVISIONS; col++) {
        const u0 = col / SUBDIVISIONS;
        const u1 = (col + 1) / SUBDIVISIONS;
        const v0 = row / SUBDIVISIONS;
        const v1 = (row + 1) / SUBDIVISIONS;

        const tl = bilerp(c[0], c[1], c[3], c[2], u0, v0);
        const tr = bilerp(c[0], c[1], c[3], c[2], u1, v0);
        const br = bilerp(c[0], c[1], c[3], c[2], u1, v1);
        const bl = bilerp(c[0], c[1], c[3], c[2], u0, v1);

        const sx = u0 * sw;
        const sy = v0 * sh;
        const sWidth = (u1 - u0) * sw;
        const sHeight = (v1 - v0) * sh;

        drawQuad(ctx, planImg, sx, sy, sWidth, sHeight, tl, tr, br, bl);
      }
    }

    canvas._offsetX = minX;
    canvas._offsetY = minY;
    setWarpedCanvas(canvas);

    // Compose with erase mask
    applyMask(canvas, maskCanvasRef.current, displayCanvasRef.current!);
    displayCanvasRef.current!._offsetX = minX;
    displayCanvasRef.current!._offsetY = minY;
    setDisplayCanvas(displayCanvasRef.current);
  }, [planImg, planView.corners]);

  // Erase stroke handler — draws on the mask canvas in warp-space coordinates
  const handleEraseStroke = useCallback(
    (stageX: number, stageY: number) => {
      if (!warpedCanvas || !maskCanvasRef.current || !displayCanvasRef.current) return;
      const offsetX = warpedCanvas._offsetX ?? 0;
      const offsetY = warpedCanvas._offsetY ?? 0;

      // Initialize mask canvas if needed
      const mc = maskCanvasRef.current;
      if (mc.width !== warpedCanvas.width || mc.height !== warpedCanvas.height) {
        mc.width = warpedCanvas.width;
        mc.height = warpedCanvas.height;
      }

      // Draw eraser circle on mask
      const ctx = mc.getContext('2d')!;
      ctx.fillStyle = 'black';
      ctx.beginPath();
      ctx.arc(stageX - offsetX, stageY - offsetY, ERASER_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // Recompose display
      applyMask(warpedCanvas, mc, displayCanvasRef.current!);
      displayCanvasRef.current!._offsetX = offsetX;
      displayCanvasRef.current!._offsetY = offsetY;
      setDisplayCanvas(Object.assign(document.createElement('canvas'), {
        width: displayCanvasRef.current!.width,
        height: displayCanvasRef.current!.height,
        _offsetX: offsetX,
        _offsetY: offsetY,
      }) as WarpCanvas);
      // Copy pixels to the new canvas for Konva to detect the change
      const dc = displayCanvasRef.current!;
      const newCanvas = document.createElement('canvas') as WarpCanvas;
      newCanvas.width = dc.width;
      newCanvas.height = dc.height;
      newCanvas._offsetX = offsetX;
      newCanvas._offsetY = offsetY;
      newCanvas.getContext('2d')!.drawImage(dc, 0, 0);
      setDisplayCanvas(newCanvas);
    },
    [warpedCanvas]
  );

  // Save mask to store on erase end
  const handleEraseEnd = useCallback(() => {
    if (!maskCanvasRef.current) return;
    const dataUrl = maskCanvasRef.current.toDataURL();
    setPlanEraseMask(dataUrl);
    isErasing.current = false;
  }, [setPlanEraseMask]);

  const handleCornerDrag = useCallback(
    (index: number, x: number, y: number) => {
      if (!planView.corners) return;
      const newCorners = [...planView.corners] as [Point2D, Point2D, Point2D, Point2D];
      newCorners[index] = { x, y };
      setPlanCorners(newCorners);
    },
    [planView.corners, setPlanCorners]
  );

  // Drag the whole overlay by moving all 4 corners together
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragStartCorners = useRef<[Point2D, Point2D, Point2D, Point2D] | null>(null);

  const handleOverlayDragStart = useCallback((e: any) => {
    if (!planView.corners || toolMode !== 'select') return;
    dragStartPos.current = { x: e.target.x(), y: e.target.y() };
    dragStartCorners.current = planView.corners.map(c => ({ ...c })) as [Point2D, Point2D, Point2D, Point2D];
  }, [planView.corners, toolMode]);

  const handleOverlayDragMove = useCallback((e: any) => {
    if (!dragStartPos.current || !dragStartCorners.current) return;
    const dx = e.target.x() - dragStartPos.current.x;
    const dy = e.target.y() - dragStartPos.current.y;
    const newCorners = dragStartCorners.current.map(c => ({
      x: c.x + dx,
      y: c.y + dy,
    })) as [Point2D, Point2D, Point2D, Point2D];
    setPlanCorners(newCorners);
  }, [setPlanCorners]);

  const handleOverlayDragEnd = useCallback((e: any) => {
    // Reset the Line position back to 0,0 since we moved the corners instead
    e.target.x(0);
    e.target.y(0);
    dragStartPos.current = null;
    dragStartCorners.current = null;
  }, []);

  // Expose eraser handlers for EditorCanvas to call
  PlanOverlay.onEraseMove = handleEraseStroke;
  PlanOverlay.onEraseEnd = handleEraseEnd;
  PlanOverlay.onEraseStart = () => { isErasing.current = true; };

  if (viewMode !== 'photo' || !planView.selectionImage || !planView.corners || !planView.visible) return null;

  const corners = planView.corners;
  const cornerColors = ['#ef4444', '#f97316', '#22c55e', '#3b82f6'];
  const offsetX = displayCanvas?._offsetX ?? warpedCanvas?._offsetX ?? 0;
  const offsetY = displayCanvas?._offsetY ?? warpedCanvas?._offsetY ?? 0;
  const showCanvas = displayCanvas ?? warpedCanvas;
  const isEraserMode = toolMode === 'eraser';

  return (
    <Group>
      {/* Warped plan image (with erase mask applied) */}
      {showCanvas && (
        <KonvaImage
          image={showCanvas}
          x={offsetX}
          y={offsetY}
          opacity={planView.opacity}
          listening={false}
        />
      )}

      {/* Draggable quad body — drag inside to move the whole overlay */}
      {!isEraserMode && (
        <Line
          points={[
            corners[0].x, corners[0].y,
            corners[1].x, corners[1].y,
            corners[2].x, corners[2].y,
            corners[3].x, corners[3].y,
          ]}
          closed
          stroke="#fff"
          strokeWidth={2}
          dash={[6, 4]}
          opacity={0.7}
          fill="transparent"
          draggable={toolMode === 'select'}
          onDragStart={handleOverlayDragStart}
          onDragMove={handleOverlayDragMove}
          onDragEnd={handleOverlayDragEnd}
        />
      )}

      {/* Draggable corner handles (hidden during eraser mode) */}
      {!isEraserMode && corners.map((corner, i) => (
        <Circle
          key={i}
          x={corner.x}
          y={corner.y}
          radius={14}
          fill={cornerColors[i]}
          stroke="#fff"
          strokeWidth={2}
          draggable={toolMode === 'select'}
          onDragMove={(e) => handleCornerDrag(i, e.target.x(), e.target.y())}
          opacity={0.9}
        />
      ))}
    </Group>
  );
}

// Static handlers for cross-component eraser communication
PlanOverlay.onEraseMove = (_x: number, _y: number) => {};
PlanOverlay.onEraseEnd = () => {};
PlanOverlay.onEraseStart = () => {};

/** Apply erase mask to warped canvas → output to display canvas */
function applyMask(src: HTMLCanvasElement, mask: HTMLCanvasElement | null, dst: HTMLCanvasElement & { _offsetX?: number; _offsetY?: number }) {
  dst.width = src.width;
  dst.height = src.height;
  const ctx = dst.getContext('2d')!;
  ctx.clearRect(0, 0, dst.width, dst.height);
  ctx.drawImage(src, 0, 0);
  if (mask && mask.width > 0 && mask.height > 0) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function bilerp(tl: Point2D, tr: Point2D, bl: Point2D, br: Point2D, u: number, v: number): Point2D {
  return {
    x: (1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + (1 - u) * v * bl.x + u * v * br.x,
    y: (1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + (1 - u) * v * bl.y + u * v * br.y,
  };
}

/** Draw a sub-quad by clipping to its outline and using an affine transform.
 *  Uses a single quad clip path — no triangle seams. */
function drawQuad(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  sx: number, sy: number, sWidth: number, sHeight: number,
  tl: Point2D, tr: Point2D, br: Point2D, bl: Point2D
) {
  if (Math.abs(sWidth) < 0.5 || Math.abs(sHeight) < 0.5) return;

  ctx.save();

  // Clip to quad outline (with 0.5px expansion to cover sub-pixel gaps)
  ctx.beginPath();
  ctx.moveTo(tl.x - 0.5, tl.y - 0.5);
  ctx.lineTo(tr.x + 0.5, tr.y - 0.5);
  ctx.lineTo(br.x + 0.5, br.y + 0.5);
  ctx.lineTo(bl.x - 0.5, bl.y + 0.5);
  ctx.closePath();
  ctx.clip();

  // Affine transform from source rect top-left corner:
  // Maps (0,0)→tl, (sWidth,0)→tr, (0,sHeight)→bl
  const a = (tr.x - tl.x) / sWidth;
  const b = (bl.x - tl.x) / sHeight;
  const c = tl.x;
  const d = (tr.y - tl.y) / sWidth;
  const e = (bl.y - tl.y) / sHeight;
  const f = tl.y;

  ctx.setTransform(a, d, b, e, c, f);
  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
  ctx.restore();
}
