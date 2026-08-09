"use client";

// Photo annotation editor — a React port of the VoiceMap single-file editor.
// Draw (pen / curve-pen with hold-to-snap), Skitch-style text pills, image
// stickers, and an eraser over a photo; on save the layers are composited onto
// a full-resolution canvas and uploaded as a new annotated image (the original
// is preserved server-side so the edit can be reverted).

import { useCallback, useEffect, useRef, useState } from "react";
import { dealPhotoUrl, type DealPhoto } from "@/lib/salesBoard";
import styles from "./photoAnnotator.module.css";

type Tool = "pen" | "curvepen" | "text" | "eraser" | "fill";

const SWATCHES = ["#ff3b30", "#ffcc00", "#30d158", "#007aff", "#ffffff", "#1a1a1a"];
const SIZES = [3, 7, 15] as const;
const TEXT_SIZES: Record<number, number> = { 3: 16, 7: 22, 15: 32 };

const MAX_UNDO = 20;
const PEN_LOCK = 1000; // ms of palm-rejection after an Apple Pencil stroke lifts
const VERTEX_LOCK_DELAY = 600; // ms of continued stillness (after a line snaps) that drops a polygon vertex

interface Pt {
  x: number;
  y: number;
  pressure: number;
}
interface TextData {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
}
interface StickerData {
  id: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  img: HTMLImageElement | null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export default function PhotoAnnotator({
  photo,
  onClose,
  onSaved,
}: {
  photo: Pick<DealPhoto, "id" | "storage_path" | "caption" | "media_type">;
  onClose: () => void;
  onSaved: (updated: DealPhoto) => void;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(SWATCHES[0]);
  const [size, setSize] = useState<number>(3);
  const [textMode, setTextMode] = useState<"edit" | "move">("edit");
  const [fillOpacity, setFillOpacity] = useState(0.3);
  const [saving, setSaving] = useState(false);
  const [textItems, setTextItems] = useState<TextData[]>([]);
  const [stickerItems, setStickerItems] = useState<StickerData[]>([]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The full-resolution original, kept off-DOM. It is drawn once into the small
  // display-resolution background canvas for editing, and used again at save
  // time to composite at full quality — but it is never a visible/composited
  // layer, so the iPad GPU isn't re-sampling a 12MP texture on every stroke
  // (the per-update cost that made the high-rate Apple Pencil lag).
  const fullImgRef = useRef<HTMLImageElement | null>(null);
  const lastSizeRef = useRef({ w: 0, h: 0 });
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);

  // Mirror the live tool/color/size into refs so the deferred straighten timer
  // (scheduled inside a pointer handler) reads current values, not stale ones.
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const textModeRef = useRef(textMode);
  const fillOpacityRef = useRef(fillOpacity);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    textModeRef.current = textMode;
  }, [textMode]);
  useEffect(() => {
    fillOpacityRef.current = fillOpacity;
  }, [fillOpacity]);

  // Drawing scratch state — refs so pointer moves never trigger re-renders.
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const pointsRef = useRef<Pt[]>([]);
  const undoStackRef = useRef<ImageData[]>([]);
  const penExpiryRef = useRef(0);
  const preStrokeRef = useRef<ImageData | null>(null);
  const straightenedRef = useRef(false);
  const straightenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const straightenOriginRef = useRef<Pt | null>(null);
  const arcP0Ref = useRef<Pt | null>(null);
  const arcP2Ref = useRef<Pt | null>(null);
  // Alt-to-bend: while a straight (pen) line is snapped, holding Option/Alt
  // locks the endpoint and turns the drag into curve-pen arc control; releasing
  // Alt reverts to the straight line. altDownRef = physical key state,
  // altCurveRef = currently bending, lastPointerRef = last drag position (so a
  // key press/release can redraw without waiting for a pointer move).
  const altDownRef = useRef(false);
  const altCurveRef = useRef(false);
  const lastPointerRef = useRef<Pt | null>(null);
  // Polygon (Shift): within a single pen stroke, each Shift tap bakes the
  // current segment and starts the next one from its endpoint. strokeActiveRef
  // = a pen stroke is in progress; shiftProcessedRef debounces key auto-repeat
  // so one physical press drops exactly one vertex.
  const strokeActiveRef = useRef(false);
  // Pen polygon: a "long hold" in one spot drops a vertex (an alternative to
  // Shift). lockTimerRef fires after the pointer has been still for
  // VERTEX_LOCK_DELAY once the line has snapped; lockOriginRef is the position
  // it was last armed at, so ordinary drag jitter doesn't keep resetting it.
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockOriginRef = useRef<Pt | null>(null);
  // Polygon fill: committed vertices of the shape being drawn. Each vertex holds
  // the control point (cp) of the curved edge leading into it, or null for a
  // straight edge. Index 0 is the start; the shape is auto-closed on lift.
  const fillVertsRef = useRef<{ x: number; y: number; cp: { x: number; y: number } | null }[]>([]);
  const shiftProcessedRef = useRef(false);
  // Canvas rect cached for the duration of a stroke. getBoundingClientRect()
  // forces a synchronous reflow, and it was being called for every coalesced
  // pointer sample (up to ~10×/move at 120Hz) — measure once per stroke instead.
  const rectRef = useRef<DOMRect | null>(null);

  // Each floating text/sticker registers a getter for its current data, so the
  // save composite reads live positions/text without the parent mutating props.
  const textApis = useRef<Map<string, () => TextData>>(new Map());
  const stickerApis = useRef<Map<string, () => StickerData>>(new Map());
  const registerText = useCallback((id: string, getter: (() => TextData) | null) => {
    if (getter) textApis.current.set(id, getter);
    else textApis.current.delete(id);
  }, []);
  const registerSticker = useCallback((id: string, getter: (() => StickerData) | null) => {
    if (getter) stickerApis.current.set(id, getter);
    else stickerApis.current.delete(id);
  }, []);

  // ── Canvas sizing ─────────────────────────────────────────────────────────
  // Size the container + both canvases to the on-screen fit, draw the photo into
  // the background canvas at display resolution, and (re)initialize the drawing
  // context. Rerunning it (e.g. on rotate) resets the drawing surface.
  const setup = useCallback(() => {
    const full = fullImgRef.current;
    const body = bodyRef.current;
    const container = containerRef.current;
    const bgCanvas = bgCanvasRef.current;
    const canvas = canvasRef.current;
    if (!full || !full.naturalWidth || !body || !container || !bgCanvas || !canvas) return;
    // Layout may not have sized the body yet when the image finishes loading —
    // computing a fit against a 0-width body produced a 1px canvas, which is the
    // intermittent "photo didn't render" bug. Bail; the ResizeObserver re-runs
    // setup once the body has a real size.
    const bw = body.clientWidth;
    const bh = body.clientHeight;
    if (bw === 0 || bh === 0) return;
    const scale = Math.min(bw / full.naturalWidth, bh / full.naturalHeight, 1);
    const dW = Math.max(1, Math.round(full.naturalWidth * scale));
    const dH = Math.max(1, Math.round(full.naturalHeight * scale));
    // Nothing changed → don't rebuild (rebuilding clears the in-progress drawing).
    if (ctxRef.current && dW === lastSizeRef.current.w && dH === lastSizeRef.current.h) return;
    lastSizeRef.current = { w: dW, h: dH };
    const dpr = window.devicePixelRatio || 1;
    // Cap the canvas backing-store pixel count. Lag tracked total canvas area,
    // not the photo: a screen-filling standard-aspect photo made a large canvas
    // that iPad Safari re-uploads to the GPU on every one of the Pencil's ~240
    // events/sec, while extreme crops (small in one dimension) stayed small and
    // smooth. Normalizing every photo to <= this area keeps standard aspect
    // ratios in the same cheap range. Ink is drawn at this density and shown/
    // saved scaled — slightly softer strokes, but consistently smooth. (Text
    // labels composite separately at full resolution, so they stay crisp.)
    const MAX_CANVAS_AREA = 1_200_000;
    const rawArea = dW * dH * dpr * dpr;
    const pr = rawArea > MAX_CANVAS_AREA ? dpr * Math.sqrt(MAX_CANVAS_AREA / rawArea) : dpr;
    container.style.width = dW + "px";
    container.style.height = dH + "px";

    // Background: the photo drawn at the (capped) display resolution.
    bgCanvas.width = Math.max(1, Math.round(dW * pr));
    bgCanvas.height = Math.max(1, Math.round(dH * pr));
    bgCanvas.style.width = dW + "px";
    bgCanvas.style.height = dH + "px";
    const bctx = bgCanvas.getContext("2d");
    if (bctx) {
      bctx.imageSmoothingQuality = "high";
      bctx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
      bctx.drawImage(full, 0, 0, bgCanvas.width, bgCanvas.height);
    }

    // Drawing layer: same display size, capped backing store.
    canvas.width = Math.max(1, Math.round(dW * pr));
    canvas.height = Math.max(1, Math.round(dH * pr));
    canvas.style.width = dW + "px";
    canvas.style.height = dH + "px";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(pr, pr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctxRef.current = ctx;
    undoStackRef.current = [];
  }, []);

  // Load the full-resolution original off-DOM, then build the display surfaces.
  useEffect(() => {
    const full = new Image();
    full.crossOrigin = "anonymous";
    full.onload = () => {
      fullImgRef.current = full;
      setup();
      setReady(true);
    };
    full.onerror = () => setLoadError(true);
    // Distinct query param so this CORS-enabled request doesn't collide with the
    // lightbox's non-CORS cached copy (which would taint the canvas at save).
    full.src = `${dealPhotoUrl(photo.storage_path)}?annotate=1`;
    return () => {
      full.onload = null;
      full.onerror = null;
    };
  }, [photo.storage_path, setup]);

  // Drive (re)layout off the body's actual size, not just window resize — this
  // fixes the load race: whichever settles last (image decode or first layout)
  // triggers a correct setup, and the size guard makes redundant fires no-ops.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === "undefined") {
      const onResize = () => setup();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const ro = new ResizeObserver(() => setup());
    ro.observe(body);
    return () => ro.disconnect();
  }, [setup]);

  useEffect(() => {
    return () => {
      if (straightenTimerRef.current) clearTimeout(straightenTimerRef.current);
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, []);

  // Lock the page behind the fixed overlay so iPadOS isn't also running scroll /
  // gesture recognition while the Apple Pencil is drawing.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ── Undo ────────────────────────────────────────────────────────────────
  function saveUndo() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    if (undoStackRef.current.length >= MAX_UNDO) undoStackRef.current.shift();
    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }
  function undo() {
    const ctx = ctxRef.current;
    if (!ctx || !undoStackRef.current.length) return;
    ctx.putImageData(undoStackRef.current.pop()!, 0, 0);
  }

  function getPos(e: PointerEvent): Pt {
    // rectRef is refreshed at each pointerdown; fall back only if a move somehow
    // arrives first. Avoids a reflow-inducing getBoundingClientRect per sample.
    const rect = rectRef.current ?? canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure > 0 ? e.pressure : 0.5 };
  }

  // Control point of the quadratic P0→P2 that passes through Q. Q's
  // perpendicular distance from the P0→P2 line sets the arch height; how far Q
  // projects ALONG the line skews the apex toward the start or end. Returns null
  // for a degenerate (zero-length) segment.
  function arcControlPoint(P0: Pt | { x: number; y: number }, P2: { x: number; y: number }, Q: { x: number; y: number }): { x: number; y: number } | null {
    const ax = P2.x - P0.x;
    const ay = P2.y - P0.y;
    const len2 = ax * ax + ay * ay;
    if (len2 < 1e-6) return null;
    // Parameter where Q sits along the axis (0 = start, 1 = end), kept off the
    // ends so the control point stays finite.
    let t = ((Q.x - P0.x) * ax + (Q.y - P0.y) * ay) / len2;
    t = Math.min(0.95, Math.max(0.05, t));
    const mt = 1 - t;
    const denom = 2 * mt * t;
    return { x: (Q.x - mt * mt * P0.x - t * t * P2.x) / denom, y: (Q.y - mt * mt * P0.y - t * t * P2.y) / denom };
  }

  // Stroke a quadratic arc from P0 to P2 passing through Q (drag sideways for a
  // symmetric arch, toward an endpoint to lean the peak that way).
  function drawArch(ctx: CanvasRenderingContext2D, P0: Pt, P2: Pt, Q: { x: number; y: number }) {
    const cp = arcControlPoint(P0, P2, Q);
    ctx.beginPath();
    ctx.moveTo(P0.x, P0.y);
    if (!cp) ctx.lineTo(P2.x, P2.y);
    else ctx.quadraticCurveTo(cp.x, cp.y, P2.x, P2.y);
    ctx.stroke();
  }

  // Render the polygon-fill shape from the pre-stroke base each frame:
  // translucent fill of the closed region + a solid outline. `cursor` is the
  // live drag position; `closeOutline` strokes the closing edge back to the
  // start (used when the shape is finalized on lift).
  function renderFill(cursor: Pt, closeOutline: boolean) {
    const ctx = ctxRef.current;
    if (!ctx || !preStrokeRef.current) return;
    const verts = fillVertsRef.current;
    if (verts.length === 0) return;
    ctx.putImageData(preStrokeRef.current, 0, 0);
    const lastV = verts[verts.length - 1];
    // Live edge from the last committed vertex to the cursor: straight, or an
    // arc to the locked endpoint while Alt-bending.
    const liveEnd = altCurveRef.current && arcP2Ref.current ? arcP2Ref.current : cursor;
    const liveCp = altCurveRef.current && arcP2Ref.current ? arcControlPoint(lastV, arcP2Ref.current, cursor) : null;
    const trace = () => {
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        const v = verts[i];
        if (v.cp) ctx.quadraticCurveTo(v.cp.x, v.cp.y, v.x, v.y);
        else ctx.lineTo(v.x, v.y);
      }
      if (liveCp) ctx.quadraticCurveTo(liveCp.x, liveCp.y, liveEnd.x, liveEnd.y);
      else ctx.lineTo(liveEnd.x, liveEnd.y);
    };
    ctx.globalCompositeOperation = "source-over";
    // Translucent fill (canvas auto-closes the path for filling).
    ctx.beginPath();
    trace();
    ctx.closePath();
    ctx.globalAlpha = fillOpacityRef.current;
    ctx.fillStyle = colorRef.current;
    ctx.fill();
    ctx.globalAlpha = 1;
    // Solid outline: only drawn edges while building; the closing edge is added
    // once the shape is finalized.
    ctx.beginPath();
    trace();
    if (closeOutline) ctx.closePath();
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = sizeRef.current * 1.5;
    ctx.stroke();
  }

  // Redraw a snapped (straightened) stroke for a given pointer position: an arc
  // when the curve pen is active OR when Alt is bending a pen line, otherwise a
  // straight line whose endpoint follows the pointer.
  function redrawStraightened(pos: Pt) {
    const ctx = ctxRef.current;
    if (!ctx || !preStrokeRef.current) return;
    const t = toolRef.current;
    if (t === "fill") {
      // A straight edge tracks the cursor; a bent one keeps its locked endpoint.
      if (!altCurveRef.current) pointsRef.current[pointsRef.current.length - 1] = pos;
      renderFill(pos, false);
      return;
    }
    ctx.putImageData(preStrokeRef.current, 0, 0);
    const base = t === "eraser" ? sizeRef.current * 6 : sizeRef.current;
    ctx.globalCompositeOperation = t === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = base * 1.5;
    const arcMode = t === "curvepen" || (t === "pen" && altCurveRef.current);
    if (arcMode && arcP0Ref.current && arcP2Ref.current) {
      // The cursor itself is the point the arc passes through, so its position
      // sets both the height and the skew of the curve.
      drawArch(ctx, arcP0Ref.current, arcP2Ref.current, pos);
    } else {
      const p1 = pointsRef.current[0];
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      pointsRef.current[pointsRef.current.length - 1] = pos;
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // Enter Alt-bend: lock the current endpoint and set up the arc so the drag now
  // controls its bulge. Only meaningful for a snapped pen line.
  function engageAltCurve() {
    const tool = toolRef.current;
    if ((tool !== "pen" && tool !== "fill") || !straightenedRef.current || altCurveRef.current) return;
    const pts = pointsRef.current;
    if (pts.length < 1) return;
    const P0 = pts[0];
    const P2 = pts[pts.length - 1]; // current endpoint = where the line ends now
    arcP0Ref.current = P0;
    arcP2Ref.current = { ...P2 };
    altCurveRef.current = true;
    redrawStraightened(lastPointerRef.current ?? P2);
  }

  // Leave Alt-bend: flatten back to a straight line but KEEP the endpoint where
  // the line ended (the locked point), rather than snapping it to wherever the
  // cursor drifted while bowing the arc. This way a hold-to-lock or Shift after
  // bowing drops the vertex at the stroke's end, not out at the apex.
  function disengageAltCurve() {
    if (!altCurveRef.current) return;
    altCurveRef.current = false;
    const end = arcP2Ref.current ?? lastPointerRef.current ?? pointsRef.current[pointsRef.current.length - 1];
    lastPointerRef.current = end;
    redrawStraightened(end);
    // Re-arm hold-to-lock at the (stable) endpoint so holding still after
    // releasing Alt drops the vertex there.
    if (toolRef.current === "pen" && end) armLockTimer(end);
  }

  // Polygon: drop a vertex mid-stroke. Bake the current segment (snapping a
  // still-freehand one to a straight line first), then start a new segment from
  // that endpoint so the drag continues the shape. Lifting the pointer ends it.
  function commitPolygonVertex() {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    const tool = toolRef.current;
    if (!ctx || !canvas || (tool !== "pen" && tool !== "fill" && tool !== "curvepen") || !strokeActiveRef.current) return;
    if (pointsRef.current.length < 1) return;
    if (straightenTimerRef.current) {
      clearTimeout(straightenTimerRef.current);
      straightenTimerRef.current = null;
    }
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
    const pos = lastPointerRef.current ?? pointsRef.current[pointsRef.current.length - 1];
    if (!pos) return;

    // Curve pen: lock the current curve segment and restart freehand from its
    // endpoint, so the next segment is drawn and auto-smoothed into a curve just
    // like the first — chaining a run of connected curves.
    if (tool === "curvepen") {
      if (!straightenedRef.current && pointsRef.current.length >= 2) straighten(); // snap freehand → curve
      const endpoint: Pt = straightenedRef.current && arcP2Ref.current ? { ...arcP2Ref.current } : { ...pos };
      preStrokeRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height); // freeze what's drawn
      pointsRef.current = [{ ...endpoint }];
      straightenedRef.current = false;
      altCurveRef.current = false;
      arcP0Ref.current = null;
      arcP2Ref.current = null;
      lastPointerRef.current = null;
      straightenOriginRef.current = { ...endpoint };
      straightenTimerRef.current = setTimeout(straighten, 600);
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = colorRef.current;
      ctx.fillStyle = colorRef.current;
      ctx.beginPath();
      ctx.moveTo(endpoint.x, endpoint.y);
      navigator.vibrate?.(8);
      return;
    }

    // Fill: append the current edge's endpoint (and its curve control point) to
    // the shape, then start the next edge there. No pixel bake — the whole fill
    // is re-rendered from the pre-stroke base each frame.
    if (tool === "fill") {
      const lastV = fillVertsRef.current[fillVertsRef.current.length - 1];
      const bent = altCurveRef.current && arcP2Ref.current;
      const endpoint: Pt = bent ? { ...arcP2Ref.current! } : { ...pos };
      const cp = bent ? arcControlPoint(lastV, arcP2Ref.current!, pos) : null;
      fillVertsRef.current.push({ x: endpoint.x, y: endpoint.y, cp });
      pointsRef.current = [{ ...endpoint }, { ...endpoint }];
      straightenedRef.current = true;
      altCurveRef.current = false;
      arcP0Ref.current = null;
      arcP2Ref.current = null;
      lastPointerRef.current = { ...endpoint };
      renderFill(endpoint, false);
      navigator.vibrate?.(8);
      return;
    }
    // A still-freehand segment becomes a straight line from its start to here.
    if (!straightenedRef.current) {
      straightenedRef.current = true;
      altCurveRef.current = false;
      arcP0Ref.current = null;
      arcP2Ref.current = null;
      redrawStraightened(pos);
    }
    const endpoint: Pt = altCurveRef.current && arcP2Ref.current ? { ...arcP2Ref.current } : { ...pos };
    // Freeze everything drawn so far; it's the base the next segment redraws on.
    preStrokeRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Begin the next segment at this vertex (two points so redraws update the
    // endpoint, not the anchor).
    pointsRef.current = [endpoint, { ...endpoint }];
    straightenedRef.current = true;
    altCurveRef.current = false;
    arcP0Ref.current = null;
    arcP2Ref.current = null;
    lastPointerRef.current = { ...endpoint };
    // Don't re-arm the hold-to-lock timer here (that would drop repeated
    // vertices while holding at the same spot). Moving away re-arms it.
    lockOriginRef.current = { ...endpoint };
    navigator.vibrate?.(8);
    // If Alt is still held, bend the new segment as soon as the drag moves.
  }

  // Re-arm the "hold in place to drop a vertex" timer for the pen polygon.
  function armLockTimer(pos: Pt) {
    lockOriginRef.current = pos;
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(lockVertex, VERTEX_LOCK_DELAY);
  }
  function clearLockTimer() {
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
    lockOriginRef.current = null;
  }
  // Fired once the pen has been held still long enough after the line snapped:
  // drop a vertex and start the next segment (same effect as tapping Shift).
  function lockVertex() {
    lockTimerRef.current = null;
    if (toolRef.current !== "pen" || !straightenedRef.current || !strokeActiveRef.current) return;
    commitPolygonVertex();
  }

  // Hold-still-to-snap: straight line (pen/eraser) or smooth arch (curve pen).
  function straighten() {
    const ctx = ctxRef.current;
    const pts = pointsRef.current;
    if (!ctx || pts.length < 2 || !preStrokeRef.current) return;
    const t = toolRef.current;
    ctx.putImageData(preStrokeRef.current, 0, 0);
    if (t === "curvepen") {
      const P0 = pts[0];
      const P2 = pts[pts.length - 1];
      const M = pts[Math.floor(pts.length / 2)]; // representative midpoint of the freehand stroke
      arcP0Ref.current = P0;
      arcP2Ref.current = P2;
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = colorRef.current;
      ctx.lineWidth = sizeRef.current * 1.5;
      // Pass the arc through the stroke's midpoint so the initial snap keeps any
      // skew the user drew; dragging then moves the point the arc passes through.
      drawArch(ctx, P0, P2, M);
    } else {
      const p1 = pts[0];
      const p2 = pts[pts.length - 1];
      const base = t === "eraser" ? sizeRef.current * 6 : sizeRef.current;
      ctx.globalCompositeOperation = t === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = colorRef.current;
      ctx.fillStyle = colorRef.current;
      ctx.lineWidth = base * 1.5;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    straightenedRef.current = true;
    navigator.vibrate?.(12);
    // If Option/Alt is already held when the pen line snaps, start bending now.
    if (toolRef.current === "pen" && altDownRef.current) engageAltCurve();
    // Pen: begin the "hold in place to drop a vertex" countdown now that the
    // line has snapped. Continuing to hold locks the vertex; moving re-arms it.
    if (toolRef.current === "pen") armLockTimer(pts[pts.length - 1]);
  }

  // ── Canvas pointer handlers ───────────────────────────────────────────────
  function onPointerDown(e: PointerEvent) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    // Measure the canvas rect once per stroke; reused by every getPos() sample.
    rectRef.current = canvasRef.current!.getBoundingClientRect();
    // Blur any focused text label so its keyboard dismisses.
    const focused = document.querySelector<HTMLElement>(`.${styles.textInput}:focus`);
    focused?.blur();

    if (toolRef.current === "text") {
      e.preventDefault();
      if (textModeRef.current === "edit" && !focused) {
        const pos = getPos(e);
        addText(pos.x, pos.y);
      }
      return;
    }

    if (e.pointerType === "touch" && e.timeStamp < penExpiryRef.current) return;
    if (e.pointerType === "pen") penExpiryRef.current = e.timeStamp + PEN_LOCK;
    e.preventDefault();
    if (straightenTimerRef.current) clearTimeout(straightenTimerRef.current);
    clearLockTimer();
    straightenedRef.current = false;
    preStrokeRef.current = null;
    straightenOriginRef.current = null;
    arcP0Ref.current = null;
    arcP2Ref.current = null;
    altCurveRef.current = false;
    lastPointerRef.current = null;
    saveUndo();
    preStrokeRef.current = undoStackRef.current[undoStackRef.current.length - 1];
    const pos = getPos(e);
    if (toolRef.current === "fill") {
      // Fill edges are straight from the start (no freehand/snap); Shift drops
      // vertices, Alt bows an edge, lift closes and fills the shape.
      fillVertsRef.current = [{ x: pos.x, y: pos.y, cp: null }];
      pointsRef.current = [pos, { ...pos }];
      strokeActiveRef.current = true;
      straightenedRef.current = true;
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = colorRef.current;
      ctx.fillStyle = colorRef.current;
      renderFill(pos, false);
      return;
    }
    pointsRef.current = [pos];
    strokeActiveRef.current = true;
    straightenOriginRef.current = pos;
    straightenTimerRef.current = setTimeout(straighten, 600);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    if (toolRef.current === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = sizeRef.current * 6;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = colorRef.current;
      ctx.fillStyle = colorRef.current;
    }
  }

  // One freehand sample → one incremental quadratic segment. Called once per
  // *coalesced* pointer sample so 120Hz input isn't thinned to the frame rate.
  function pushFreehand(pos: Pt) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    pointsRef.current.push(pos);
    const len = pointsRef.current.length;
    if (len < 2) return;
    const p1 = pointsRef.current[len - 2];
    const p2 = pointsRef.current[len - 1];
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const base = toolRef.current === "eraser" ? sizeRef.current * 6 : sizeRef.current;
    ctx.lineWidth = base * (0.4 + p2.pressure * 1.2);
    ctx.quadraticCurveTo(p1.x, p1.y, mid.x, mid.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y);
    const origin = straightenOriginRef.current;
    if (origin) {
      const dist = Math.hypot(pos.x - origin.x, pos.y - origin.y);
      if (dist > 4) {
        straightenOriginRef.current = pos;
        if (straightenTimerRef.current) clearTimeout(straightenTimerRef.current);
        straightenTimerRef.current = setTimeout(straighten, 600);
      }
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!e.buttons) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (toolRef.current === "text") return;
    if (e.pointerType === "touch" && e.timeStamp < penExpiryRef.current) return;
    if (!pointsRef.current.length) return;
    if (e.pointerType === "pen") penExpiryRef.current = e.timeStamp + PEN_LOCK;
    e.preventDefault();

    if (straightenedRef.current) {
      const pos = getPos(e);
      lastPointerRef.current = pos;
      redrawStraightened(pos);
      // Pen: while adjusting a snapped segment, re-arm the hold-to-lock timer on
      // real movement so it only fires once you settle on a spot.
      if (toolRef.current === "pen") {
        const o = lockOriginRef.current;
        if (!o || Math.hypot(pos.x - o.x, pos.y - o.y) > 4) armLockTimer(pos);
      }
      return;
    }

    // One draw per pointermove — exactly like the original VoiceMap editor.
    // (Replaying getCoalescedEvents() multiplied per-event work by the Apple
    // Pencil's high sample rate, which made drawing lag only on the iPad.)
    pushFreehand(getPos(e));
  }

  function onPointerUp(e: PointerEvent) {
    const ctx = ctxRef.current;
    if (straightenTimerRef.current) clearTimeout(straightenTimerRef.current);
    straightenTimerRef.current = null;
    clearLockTimer();
    strokeActiveRef.current = false;
    if (!ctx) return;
    if (e.pointerType === "pen") penExpiryRef.current = e.timeStamp + PEN_LOCK;
    if (toolRef.current === "fill") {
      const q = lastPointerRef.current ?? pointsRef.current[pointsRef.current.length - 1] ?? null;
      if (q && fillVertsRef.current.length >= 1) renderFill(q, true); // close + fill
      fillVertsRef.current = [];
      pointsRef.current = [];
      straightenedRef.current = false;
      preStrokeRef.current = null;
      altCurveRef.current = false;
      arcP0Ref.current = null;
      arcP2Ref.current = null;
      lastPointerRef.current = null;
      ctx.globalCompositeOperation = "source-over";
      return;
    }
    if (straightenedRef.current) {
      pointsRef.current = [];
      straightenedRef.current = false;
      preStrokeRef.current = null;
      altCurveRef.current = false;
      lastPointerRef.current = null;
      ctx.globalCompositeOperation = "source-over";
      return;
    }
    if (pointsRef.current.length === 1 && toolRef.current !== "text") {
      const pos = pointsRef.current[0];
      const base = toolRef.current === "eraser" ? sizeRef.current * 6 : sizeRef.current;
      ctx.lineWidth = base;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(base / 2, 1), 0, Math.PI * 2);
      ctx.fill();
    }
    pointsRef.current = [];
    preStrokeRef.current = null;
    ctx.globalCompositeOperation = "source-over";
  }

  // ── Text labels ───────────────────────────────────────────────────────────
  function addText(x: number, y: number) {
    const t: TextData = { id: crypto.randomUUID(), text: "", x, y, color: colorRef.current, fontSize: TEXT_SIZES[sizeRef.current] || 22 };
    setTextItems((prev) => [...prev, t]);
  }
  function removeText(id: string) {
    setTextItems((prev) => prev.filter((t) => t.id !== id));
  }

  // ── Stickers ──────────────────────────────────────────────────────────────
  function loadSticker(src: string) {
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      const container = containerRef.current;
      if (!container) return;
      const cW = container.clientWidth;
      const cH = container.clientHeight;
      const w = Math.min(cW * 0.4, probe.naturalWidth);
      const h = w * (probe.naturalHeight / probe.naturalWidth);
      const s: StickerData = { id: crypto.randomUUID(), src, x: cW / 2, y: cH / 2, w, h, img: null };
      setStickerItems((prev) => [...prev, s]);
    };
    probe.src = src;
  }
  function removeSticker(id: string) {
    setStickerItems((prev) => prev.filter((s) => s.id !== id));
  }
  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadSticker(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  // Paste an image from the clipboard as a sticker while the editor is open.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => loadSticker(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // Tool selection helper (mirrors VoiceMap: picking a swatch also jumps to pen).
  function selectTool(next: Tool) {
    setTool(next);
    if (next !== "text") document.querySelector<HTMLElement>(`.${styles.textInput}:focus`)?.blur();
  }
  function onTextButton() {
    if (tool === "text") {
      setTextMode((m) => {
        const nextMode = m === "edit" ? "move" : "edit";
        if (nextMode === "move") document.querySelector<HTMLElement>(`.${styles.textInput}:focus`)?.blur();
        return nextMode;
      });
    } else {
      setTextMode("edit");
      selectTool("text");
    }
  }

  // ── Save (composite + upload) ─────────────────────────────────────────────
  async function save() {
    const full = fullImgRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!full || !canvas || !container) return;
    setSaving(true);
    try {
      // Composite at the ORIGINAL full resolution: the display background was a
      // downscaled copy, but the saved output uses the full-res source so no
      // quality is lost.
      const out = document.createElement("canvas");
      out.width = full.naturalWidth;
      out.height = full.naturalHeight;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.drawImage(full, 0, 0);
      ctx.drawImage(canvas, 0, 0, out.width, out.height);

      const scaleX = out.width / container.clientWidth;
      const scaleY = out.height / container.clientHeight;
      const avgScale = (scaleX + scaleY) / 2;

      for (const getSticker of stickerApis.current.values()) {
        const s = getSticker();
        if (s.img?.complete) ctx.drawImage(s.img, (s.x - s.w / 2) * scaleX, (s.y - s.h / 2) * scaleY, s.w * scaleX, s.h * scaleY);
      }

      ctx.textBaseline = "top";
      for (const getText of textApis.current.values()) {
        const t = getText();
        if (!t.text.trim()) continue;
        const fs = t.fontSize * avgScale;
        ctx.font = `800 ${fs}px -apple-system,"Helvetica Neue",Arial,sans-serif`;
        const tw = ctx.measureText(t.text).width;
        const px = 10 * scaleX;
        const py = 5 * scaleY;
        const bx = t.x * scaleX;
        const by = t.y * scaleY;
        const bw = tw + px * 2;
        const bh = fs * 1.25 + py * 2;
        roundRect(ctx, bx, by, bw, bh, 6 * avgScale);
        ctx.fillStyle = t.color;
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.38)";
        ctx.lineWidth = 2.5 * avgScale;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(t.text, bx + px, by + py + fs * 0.05);
      }

      const blob: Blob = await new Promise((resolve, reject) =>
        out.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to render image"))), "image/jpeg", 0.9)
      );

      const formData = new FormData();
      formData.append("file", new File([blob], "annotated.jpg", { type: "image/jpeg" }));
      const res = await fetch(`/api/photos/${photo.id}/annotate`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save annotation");
      onSaved(data.photo as DealPhoto);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save annotation");
    } finally {
      setSaving(false);
    }
  }

  // Attach NATIVE pointer listeners with { passive: false }. React's synthetic
  // event system delegates at the root, thins high-frequency/coalesced samples,
  // and can't reliably preventDefault here — which made drawing feel laggy and
  // jumpy versus the original. A ref keeps the listeners pointed at the latest
  // handler closures without re-attaching on every render. Declared after the
  // handlers so they're referenced, not hoisted-before-definition.
  const handlersRef = useRef({ down: onPointerDown, move: onPointerMove, up: onPointerUp });
  useEffect(() => {
    handlersRef.current = { down: onPointerDown, move: onPointerMove, up: onPointerUp };
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      handlersRef.current.down(e);
    };
    const move = (e: PointerEvent) => {
      if (e.buttons) handlersRef.current.move(e);
    };
    const up = (e: PointerEvent) => handlersRef.current.up(e);
    canvas.addEventListener("pointerdown", down, { passive: false });
    canvas.addEventListener("pointermove", move, { passive: false });
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }, []);

  // Keyboard modifiers: Option/Alt bends a snapped pen line into a curve; Shift
  // drops a polygon vertex mid-stroke. A ref keeps the document listeners
  // pointed at the latest closures.
  const keyApiRef = useRef({ engage: engageAltCurve, disengage: disengageAltCurve, commit: commitPolygonVertex });
  useEffect(() => {
    keyApiRef.current = { engage: engageAltCurve, disengage: disengageAltCurve, commit: commitPolygonVertex };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altDownRef.current = true;
        if (!e.repeat && straightenedRef.current && (toolRef.current === "pen" || toolRef.current === "fill") && !altCurveRef.current) {
          e.preventDefault();
          keyApiRef.current.engage();
        }
      } else if (e.key === "Shift") {
        if (shiftProcessedRef.current) return; // ignore key auto-repeat
        shiftProcessedRef.current = true;
        const t = toolRef.current;
        if ((t === "pen" || t === "fill" || t === "curvepen") && strokeActiveRef.current && pointsRef.current.length >= 1) {
          e.preventDefault();
          keyApiRef.current.commit();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altDownRef.current = false;
        if (altCurveRef.current) keyApiRef.current.disengage();
      } else if (e.key === "Shift") {
        shiftProcessedRef.current = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        <button type="button" className={styles.headerBtn} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <span className={styles.title}>Annotate Photo</span>
        <button type="button" className={`${styles.headerBtn} ${styles.saveBtn}`} onClick={save} disabled={saving || !ready}>
          {saving ? "Saving…" : "Save & Close"}
        </button>
      </div>

      <div className={styles.body} ref={bodyRef}>
        <div className={styles.imgContainer} ref={containerRef}>
          {/* Display-resolution copy of the photo (drawn in setup()). Using a
              small canvas rather than the full-res <img> keeps the iPad from
              recompositing a 12MP texture under the live drawing layer. */}
          <canvas ref={bgCanvasRef} className={styles.bg} />
          {/* Pointer listeners are attached natively (passive:false) in an
              effect above — not as React props — for input responsiveness. */}
          <canvas ref={canvasRef} className={styles.canvas} />
          {stickerItems.map((s) => (
            <StickerEl key={s.id} initial={s} containerRef={containerRef} register={registerSticker} onRemove={() => removeSticker(s.id)} />
          ))}
          {textItems.map((t) => (
            <TextLabel
              key={t.id}
              initial={t}
              interactive={tool === "text"}
              moveMode={textMode === "move"}
              containerRef={containerRef}
              register={registerText}
              onRemove={() => removeText(t.id)}
            />
          ))}
        </div>
        {!ready && !loadError && <div className={styles.spinner}>Loading…</div>}
        {loadError && <div className={styles.spinner}>Couldn’t load the photo.</div>}
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "pen" ? styles.active : ""}`}
          title="Pen — hold still to snap to a straight line; keep holding in place to drop a polygon vertex and continue (or tap Shift); hold Option/Alt to bend an edge into a curve"
          onClick={() => selectTool("pen")}
        >
          ✏
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "curvepen" ? styles.active : ""}`}
          title="Curve pen — draw and hold still to smooth into a curve; tap Shift while drawing to lock a vertex and chain another curve"
          onClick={() => selectTool("curvepen")}
        >
          ⌣
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "text" ? styles.active : ""} ${tool === "text" && textMode === "move" ? styles.textMove : ""}`}
          title="Text label (tap again to toggle move mode)"
          onClick={onTextButton}
        >
          T
        </button>
        <button type="button" className={`${styles.toolBtn} ${tool === "eraser" ? styles.active : ""}`} title="Eraser" onClick={() => selectTool("eraser")}>
          ⌫
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "fill" ? styles.active : ""}`}
          title="Polygon fill — draw an edge, tap Shift to drop corners, hold Option/Alt to bow an edge, lift to close and fill"
          onClick={() => selectTool("fill")}
        >
          ⬢
        </button>
        <div className={styles.sep} />
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.swatch} ${color === c ? styles.active : ""}`}
            style={{ background: c, ...(c === "#ffffff" ? { border: "1.5px solid #aaa" } : {}) }}
            aria-label={`Color ${c}`}
            onClick={() => {
              setColor(c);
              if (tool === "eraser") selectTool("pen");
            }}
          />
        ))}
        <div className={styles.sep} />
        {SIZES.map((sz) => (
          <button
            key={sz}
            type="button"
            className={`${styles.sizeBtn} ${size === sz ? styles.active : ""}`}
            title={sz === 3 ? "Fine" : sz === 7 ? "Medium" : "Thick"}
            onClick={() => setSize(sz)}
          >
            <span className={styles.sizeDot} style={{ width: sz + 5, height: sz + 5 }} />
          </button>
        ))}
        {tool === "fill" && (
          <>
            <div className={styles.sep} />
            <div className={styles.opacityWrap} title="Fill opacity">
              <span className={styles.opacityLabel}>Fill</span>
              <input
                type="range"
                min={5}
                max={80}
                value={Math.round(fillOpacity * 100)}
                onChange={(e) => setFillOpacity(parseInt(e.target.value, 10) / 100)}
                className={styles.opacitySlider}
                aria-label="Fill opacity"
              />
              <span className={styles.opacityVal}>{Math.round(fillOpacity * 100)}%</span>
            </div>
          </>
        )}
        <div className={styles.sep} />
        <button type="button" className={styles.toolBtn} title="Add image / sticker" onClick={() => fileInputRef.current?.click()}>
          ⊕
        </button>
        <button type="button" className={styles.toolBtn} title="Undo" onClick={undo}>
          ↩
        </button>
      </div>

      {/* Bottom action bar. The top header can sit under iPad Safari's toolbar,
          so the primary finish/cancel controls live here where the tool row is
          reliably visible and reachable. */}
      <div className={styles.actionBar}>
        <button type="button" className={styles.actionCancel} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="button" className={styles.actionSave} onClick={save} disabled={saving || !ready}>
          {saving ? "Saving…" : "✓ Save & Close"}
        </button>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFilePicked} />
    </div>
  );
}

// ── Floating text label ───────────────────────────────────────────────────
function TextLabel({
  initial,
  interactive,
  moveMode,
  containerRef,
  register,
  onRemove,
}: {
  initial: TextData;
  interactive: boolean;
  moveMode: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  register: (id: string, getter: (() => TextData) | null) => void;
  onRemove: () => void;
}) {
  const [pos, setPos] = useState({ x: initial.x, y: initial.y });
  const wrapRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  // Owns the live data the save composite reads — never a mutated prop.
  const dataRef = useRef<TextData>({ ...initial });
  const drag = useRef({ ox: 0, oy: 0, moved: false, ptrType: "" });

  useEffect(() => {
    dataRef.current.x = pos.x;
    dataRef.current.y = pos.y;
  }, [pos]);

  // Register a getter for compositing; unregister on unmount.
  useEffect(() => {
    register(initial.id, () => dataRef.current);
    return () => register(initial.id, null);
  }, [initial.id, register]);

  // Seed the contentEditable once and auto-focus a fresh (empty) label. The
  // span is never given React children afterward, so re-renders never disturb
  // the caret or typed text.
  useEffect(() => {
    const span = spanRef.current;
    if (!span) return;
    span.textContent = dataRef.current.text;
    if (!dataRef.current.text) requestAnimationFrame(() => focusSpan());
  }, []);

  function focusSpan() {
    const span = spanRef.current;
    if (!span) return;
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function onPointerDown(e: React.PointerEvent) {
    const forcesDrag = e.pointerType === "pen" || moveMode;
    if (!forcesDrag && document.activeElement === spanRef.current) return; // editing — hands off
    e.preventDefault();
    wrapRef.current?.setPointerCapture(e.pointerId);
    drag.current.moved = false;
    drag.current.ptrType = e.pointerType;
    const rect = containerRef.current!.getBoundingClientRect();
    drag.current.ox = dataRef.current.x - (e.clientX - rect.left);
    drag.current.oy = dataRef.current.y - (e.clientY - rect.top);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!e.buttons) return;
    const forcesDrag = e.pointerType === "pen" || moveMode;
    if (!forcesDrag && document.activeElement === spanRef.current) return;
    drag.current.moved = true;
    const rect = containerRef.current!.getBoundingClientRect();
    const nx = e.clientX - rect.left + drag.current.ox;
    const ny = e.clientY - rect.top + drag.current.oy;
    // Move the DOM node directly (no per-move re-render); state is synced on up.
    dataRef.current.x = nx;
    dataRef.current.y = ny;
    if (wrapRef.current) {
      wrapRef.current.style.left = nx + "px";
      wrapRef.current.style.top = ny + "px";
    }
  }
  function onPointerUp() {
    if (drag.current.moved) setPos({ x: dataRef.current.x, y: dataRef.current.y });
    else if (drag.current.ptrType !== "pen" && !moveMode) focusSpan();
    drag.current.moved = false;
    drag.current.ptrType = "";
  }

  return (
    <div
      ref={wrapRef}
      className={styles.textWrap}
      style={{ left: pos.x, top: pos.y, pointerEvents: interactive ? "auto" : "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <span
        ref={spanRef}
        className={styles.textInput}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-ph="Type here…"
        style={{ fontSize: initial.fontSize, background: initial.color }}
        onInput={(e) => {
          dataRef.current.text = e.currentTarget.textContent || "";
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        className={styles.del}
        title="Remove text"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ── Floating image sticker ─────────────────────────────────────────────────
function StickerEl({
  initial,
  containerRef,
  register,
  onRemove,
}: {
  initial: StickerData;
  containerRef: React.RefObject<HTMLDivElement | null>;
  register: (id: string, getter: (() => StickerData) | null) => void;
  onRemove: () => void;
}) {
  const [box, setBox] = useState({ x: initial.x, y: initial.y, w: initial.w, h: initial.h });
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dataRef = useRef<StickerData>({ ...initial });
  const drag = useRef<{ ox: number; oy: number } | null>(null);
  const resize = useRef<{ startW: number; startH: number; startX: number } | null>(null);
  const pinch = useRef<{ dist: number; w: number; h: number } | null>(null);

  // Push the current dataRef box straight to the DOM node (no re-render).
  const applyStyle = useCallback(() => {
    const wrap = wrapRef.current;
    const d = dataRef.current;
    if (!wrap) return;
    wrap.style.left = d.x - d.w / 2 + "px";
    wrap.style.top = d.y - d.h / 2 + "px";
    wrap.style.width = d.w + "px";
    wrap.style.height = d.h + "px";
  }, []);

  useEffect(() => {
    register(initial.id, () => ({ ...dataRef.current, img: imgRef.current }));
    return () => register(initial.id, null);
  }, [initial.id, register]);

  function commit() {
    setBox({ x: dataRef.current.x, y: dataRef.current.y, w: dataRef.current.w, h: dataRef.current.h });
  }

  function onPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    wrapRef.current?.setPointerCapture(e.pointerId);
    const rect = containerRef.current!.getBoundingClientRect();
    drag.current = { ox: dataRef.current.x - (e.clientX - rect.left), oy: dataRef.current.y - (e.clientY - rect.top) };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current || !e.buttons) return;
    e.stopPropagation();
    const rect = containerRef.current!.getBoundingClientRect();
    dataRef.current.x = e.clientX - rect.left + drag.current.ox;
    dataRef.current.y = e.clientY - rect.top + drag.current.oy;
    applyStyle();
  }
  function onPointerUp() {
    if (drag.current) commit();
    drag.current = null;
  }

  function onResizeDown(e: React.PointerEvent) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resize.current = { startW: dataRef.current.w, startH: dataRef.current.h, startX: e.clientX };
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!resize.current || !e.buttons) return;
    e.stopPropagation();
    const dx = e.clientX - resize.current.startX;
    const ratio = resize.current.startH / resize.current.startW;
    const w = Math.max(20, resize.current.startW + dx);
    dataRef.current.w = w;
    dataRef.current.h = w * ratio;
    applyStyle();
  }
  function onResizeUp() {
    if (resize.current) commit();
    resize.current = null;
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const [t1, t2] = [e.touches[0], e.touches[1]];
    pinch.current = { dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY), w: dataRef.current.w, h: dataRef.current.h };
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 2 || !pinch.current) return;
    e.preventDefault();
    const [t1, t2] = [e.touches[0], e.touches[1]];
    const scale = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY) / pinch.current.dist;
    dataRef.current.w = Math.max(20, pinch.current.w * scale);
    dataRef.current.h = Math.max(20, pinch.current.h * scale);
    applyStyle();
  }
  function onTouchEnd() {
    if (pinch.current) commit();
    pinch.current = null;
  }

  return (
    <div
      ref={wrapRef}
      className={styles.stickerWrap}
      style={{ left: box.x - box.w / 2, top: box.y - box.h / 2, width: box.w, height: box.h }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={initial.src} draggable={false} alt="" crossOrigin="anonymous" />
      <button
        type="button"
        className={styles.del}
        title="Remove sticker"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ✕
      </button>
      <div className={styles.stickerResize} onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} />
    </div>
  );
}
