import { useRef, useEffect, useState } from 'react';
import { Image as KonvaImage } from 'react-konva';
import type { LightSource } from '../../types';

interface Props {
  backgroundImage: string;
  bgWidth: number;
  bgHeight: number;
  lights: LightSource[];
  overlayColor: string;
  overlayOpacity: number;
  penMask: string | null;
  /** Exposed so LightingCanvas can draw strokes directly during a drag */
  penMaskCanvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
  /** Incremented by LightingCanvas on each pen stroke to trigger re-render */
  penMaskVersion?: number;
}

export function LightingOverlay({
  backgroundImage,
  bgWidth,
  bgHeight,
  lights,
  overlayColor,
  overlayOpacity,
  penMask,
  penMaskCanvasRef,
  penMaskVersion,
}: Props) {
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const internalMaskRef = useRef<HTMLCanvasElement | null>(null);
  const [displayCanvas, setDisplayCanvas] = useState<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);

  // Expose the internal mask canvas so LightingCanvas can paint on it
  useEffect(() => {
    if (penMaskCanvasRef) {
      if (!internalMaskRef.current && bgWidth && bgHeight) {
        internalMaskRef.current = document.createElement('canvas');
        internalMaskRef.current.width = bgWidth;
        internalMaskRef.current.height = bgHeight;
      }
      penMaskCanvasRef.current = internalMaskRef.current;
    }
  }, [penMaskCanvasRef, bgWidth, bgHeight]);

  // Load background image element
  useEffect(() => {
    if (!backgroundImage) return;
    const img = new window.Image();
    img.onload = () => {
      bgImageRef.current = img;
      render();
    };
    img.src = backgroundImage;
  }, [backgroundImage]);

  // Load persisted pen mask from data URL into the mask canvas
  useEffect(() => {
    if (!penMask || !bgWidth || !bgHeight) return;
    if (!internalMaskRef.current) {
      internalMaskRef.current = document.createElement('canvas');
    }
    const mc = internalMaskRef.current;
    mc.width = bgWidth;
    mc.height = bgHeight;
    const img = new window.Image();
    img.onload = () => {
      const ctx = mc.getContext('2d')!;
      ctx.clearRect(0, 0, bgWidth, bgHeight);
      ctx.drawImage(img, 0, 0);
      if (penMaskCanvasRef) penMaskCanvasRef.current = mc;
      render();
    };
    img.src = penMask;
  }, [penMask, bgWidth, bgHeight]);

  // Ensure offscreen canvases exist and are sized correctly
  useEffect(() => {
    if (!bgWidth || !bgHeight) return;
    if (!overlayCanvasRef.current) {
      overlayCanvasRef.current = document.createElement('canvas');
    }
    if (!displayCanvasRef.current) {
      displayCanvasRef.current = document.createElement('canvas');
    }
    overlayCanvasRef.current.width = bgWidth;
    overlayCanvasRef.current.height = bgHeight;
    displayCanvasRef.current.width = bgWidth;
    displayCanvasRef.current.height = bgHeight;
    if (!internalMaskRef.current) {
      internalMaskRef.current = document.createElement('canvas');
      internalMaskRef.current.width = bgWidth;
      internalMaskRef.current.height = bgHeight;
    }
  }, [bgWidth, bgHeight]);

  function render() {
    const bgImg = bgImageRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const dispCanvas = displayCanvasRef.current;
    if (!bgImg || !overlayCanvas || !dispCanvas || !bgWidth || !bgHeight) return;

    const w = bgWidth;
    const h = bgHeight;

    // ---- Overlay canvas: fill night color, punch out lights + pen mask ----
    const oCtx = overlayCanvas.getContext('2d')!;
    oCtx.clearRect(0, 0, w, h);

    // Solid fill with globalAlpha controlling darkness
    oCtx.globalCompositeOperation = 'source-over';
    oCtx.fillStyle = 'rgb(20, 0, 40)';
    oCtx.globalAlpha = Math.min(overlayOpacity, 1);
    oCtx.fillRect(0, 0, w, h);
    if (overlayOpacity > 0.5) {
      oCtx.globalAlpha = (overlayOpacity - 0.5) * 2;
      oCtx.fillRect(0, 0, w, h);
    }
    oCtx.globalAlpha = 1;

    // Punch holes for each light
    oCtx.globalCompositeOperation = 'destination-out';
    for (const light of lights) {
      const px = light.x * w;
      const py = light.y * h;
      const beam = light.beamAngle ?? 360;
      const dist = light.distance ?? light.radius;

      oCtx.save();
      oCtx.translate(px, py);
      oCtx.rotate((light.rotation * Math.PI) / 180);

      if (beam >= 360) {
        // Full omnidirectional light (path lights)
        oCtx.scale(light.spreadX, light.spreadY);
        const gradient = oCtx.createRadialGradient(0, 0, 0, 0, 0, light.radius);
        gradient.addColorStop(0, `rgba(0,0,0,${light.intensity})`);
        gradient.addColorStop(0.5, `rgba(0,0,0,${light.intensity * 0.5})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        oCtx.fillStyle = gradient;
        oCtx.beginPath();
        oCtx.arc(0, 0, light.radius, 0, Math.PI * 2);
        oCtx.fill();
      } else {
        // Cone/wedge beam with soft edges — rendered on a temp canvas then stamped
        const halfAngle = (beam / 2) * (Math.PI / 180);
        const pad = 4; // extra pixels
        const size = (dist + pad) * 2;
        const tc = document.createElement('canvas');
        tc.width = size;
        tc.height = size;
        const tCtx = tc.getContext('2d')!;
        const cx = size / 2;
        const cy = size / 2;

        // 1. Draw the soft radial gradient (full circle, same falloff as path lights)
        const radGrad = tCtx.createRadialGradient(cx, cy, 0, cx, cy, dist);
        radGrad.addColorStop(0, `rgba(0,0,0,${light.intensity})`);
        radGrad.addColorStop(0.3, `rgba(0,0,0,${light.intensity * 0.7})`);
        radGrad.addColorStop(0.7, `rgba(0,0,0,${light.intensity * 0.3})`);
        radGrad.addColorStop(1, 'rgba(0,0,0,0)');
        tCtx.fillStyle = radGrad;
        tCtx.beginPath();
        tCtx.arc(cx, cy, dist, 0, Math.PI * 2);
        tCtx.fill();

        // 2. Mask to the cone shape with soft angular edges using destination-in
        //    Draw a cone-shaped alpha mask with feathered edges
        tCtx.globalCompositeOperation = 'destination-in';
        const feather = Math.min(halfAngle * 0.5, 0.25); // soft edge width in radians
        const coneDir = -Math.PI / 2; // points up
        const slices = 64;
        for (let i = 0; i < slices; i++) {
          const angle = (i / slices) * Math.PI * 2 - Math.PI;
          const nextAngle = ((i + 1) / slices) * Math.PI * 2 - Math.PI;
          // Angular distance from cone center axis
          let delta = angle - coneDir;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          const absDelta = Math.abs(delta);
          // Compute opacity: 1 inside cone, fade to 0 at edges
          let alpha: number;
          if (absDelta <= halfAngle - feather) {
            alpha = 1;
          } else if (absDelta >= halfAngle + feather) {
            alpha = 0;
          } else {
            alpha = 1 - (absDelta - (halfAngle - feather)) / (feather * 2);
          }
          if (alpha <= 0) continue;
          tCtx.fillStyle = `rgba(0,0,0,${alpha})`;
          tCtx.beginPath();
          tCtx.moveTo(cx, cy);
          tCtx.arc(cx, cy, dist + pad, angle, nextAngle);
          tCtx.closePath();
          tCtx.fill();
        }
        tCtx.globalCompositeOperation = 'source-over';

        // 3. Stamp the soft cone onto the main overlay canvas
        oCtx.drawImage(tc, px - cx, py - cy);
      }

      oCtx.restore();
    }

    // Punch out the freehand pen mask
    const mc = internalMaskRef.current;
    if (mc && mc.width > 0 && mc.height > 0) {
      oCtx.drawImage(mc, 0, 0);
    }

    oCtx.globalCompositeOperation = 'source-over';

    // ---- Display canvas: background + overlay ----
    const dCtx = dispCanvas.getContext('2d')!;
    dCtx.clearRect(0, 0, w, h);
    dCtx.drawImage(bgImg, 0, 0, w, h);
    dCtx.drawImage(overlayCanvas, 0, 0);

    // Force Konva to detect change via new canvas reference
    const freshCanvas = document.createElement('canvas');
    freshCanvas.width = w;
    freshCanvas.height = h;
    freshCanvas.getContext('2d')!.drawImage(dispCanvas, 0, 0);
    setDisplayCanvas(freshCanvas);
  }

  // Re-render when anything changes (RAF-gated)
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => render());
    return () => cancelAnimationFrame(rafRef.current);
  }, [lights, overlayColor, overlayOpacity, bgWidth, bgHeight, backgroundImage, penMaskVersion]);

  if (!displayCanvas) return null;

  return <KonvaImage image={displayCanvas} x={0} y={0} listening={false} />;
}
