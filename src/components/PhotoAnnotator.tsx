"use client";

// Photo annotation editor — a React port of the VoiceMap single-file editor.
// Draw (pen / curve-pen with hold-to-snap), Skitch-style text pills, image
// stickers, and an eraser over a photo; on save the layers are composited onto
// a full-resolution canvas and uploaded as a new annotated image (the original
// is preserved server-side so the edit can be reverted).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { dealPhotoUrl, type DealPhoto } from "@/lib/salesBoard";
import styles from "./photoAnnotator.module.css";

type Tool = "pen" | "curvepen" | "text" | "eraser" | "fill" | "prism" | "ellipse" | "rectangle";

const SWATCHES = ["#ff3b30", "#ffcc00", "#30d158", "#007aff", "#ffffff", "#1a1a1a"];
const SIZES = [3, 7, 15] as const;
const TEXT_SIZES: Record<number, number> = { 3: 16, 7: 22, 15: 32 };
type LineStyle = "solid" | "dashed" | "dotted";
// `css` is the CSS border-style used to render the picker glyph.
const LINE_STYLES: { key: LineStyle; css: "solid" | "dashed" | "dotted"; label: string }[] = [
  { key: "solid", css: "solid", label: "Solid line" },
  { key: "dashed", css: "dashed", label: "Dashed line" },
  { key: "dotted", css: "dotted", label: "Dotted line" },
];

const MAX_UNDO = 20;
const PEN_LOCK = 1000; // ms of palm-rejection after an Apple Pencil stroke lifts
const VERTEX_LOCK_DELAY = 600; // ms of continued stillness (after a line snaps) that drops a polygon vertex (fill/curve pen)
// Cue-tool (pen / polygon fill) hold has two stages: a yellow "you can curve now"
// cue, then the blue vertex lock. Moving between them bends the edge into a curve
// instead of locking it straight.
const PEN_CURVE_CUE_DELAY = 820; // ms after settle → yellow cue appears
const PEN_VERTEX_LOCK_DELAY = 1460; // ms after settle → blue vertex lock (window = ~640ms)

// Toolbar icons as inline SVG (stroke = currentColor). Unicode/emoji glyphs
// rendered dark and low-contrast on iOS Safari (it substitutes the color-emoji
// font and ignores CSS color); these are guaranteed legible and consistent.
const ICON_PATHS: Record<string, ReactNode> = {
  pen: (
    <>
      <path d="M4 20l4.5-1L20 7.5a2.1 2.1 0 0 0-3-3L5.5 16 4 20z" />
      <path d="M13.5 6.5l3 3" />
    </>
  ),
  curve: <path d="M3 16.5C7 8 17 8 21 16.5" />,
  text: <path d="M5 6h14M12 6v12" />,
  eraser: (
    <>
      <path d="M4 15l7-7 6 6-4 4H8z" />
      <path d="M9 20h11" />
    </>
  ),
  fill: <path d="M7 4h10l4 8-4 8H7l-4-8z" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6.5" />,
  rect: <rect x="3.5" y="6" width="17" height="12" rx="1.5" />,
  prism: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  add: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9h10a6 6 0 0 1 0 12H9" />
      <path d="M8 5L4 9l4 4" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9H10a6 6 0 0 0 0 12h5" />
      <path d="M16 5l4 4-4 4" />
    </>
  ),
};
function Ico({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

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
  const [lineStyle, setLineStyle] = useState<LineStyle>("solid");
  const [textMode, setTextMode] = useState<"edit" | "move">("edit");
  const [fillOpacity, setFillOpacity] = useState(0.3);
  // Fill/prism edge mode: true = curve window (yellow cue, slower lock, edges can
  // bow); false = fast hard corners (quick lock, straight only). Toggled in the
  // toolbar. The pen always uses the curve window regardless.
  const [fillCurveMode, setFillCurveMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [textItems, setTextItems] = useState<TextData[]>([]);
  const [stickerItems, setStickerItems] = useState<StickerData[]>([]);
  // Transient "vertex dropped" pulses (DOM overlay, not drawn on the canvas, so
  // they never bake into the annotation). Each removes itself on animation end.
  const [pulses, setPulses] = useState<{ id: string; x: number; y: number }[]>([]);
  // The pen "yellow" curve cue: a steady dot shown while the curve window is open.
  const [curveCue, setCurveCue] = useState<{ x: number; y: number } | null>(null);

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
  const lineStyleRef = useRef(lineStyle);
  const textModeRef = useRef(textMode);
  const fillOpacityRef = useRef(fillOpacity);
  const fillCurveModeRef = useRef(fillCurveMode);
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
    lineStyleRef.current = lineStyle;
  }, [lineStyle]);
  useEffect(() => {
    textModeRef.current = textMode;
  }, [textMode]);
  useEffect(() => {
    fillOpacityRef.current = fillOpacity;
  }, [fillOpacity]);
  useEffect(() => {
    fillCurveModeRef.current = fillCurveMode;
  }, [fillCurveMode]);

  // Drawing scratch state — refs so pointer moves never trigger re-renders.
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const pointsRef = useRef<Pt[]>([]);
  const undoStackRef = useRef<ImageData[]>([]);
  const redoStackRef = useRef<ImageData[]>([]);
  const penExpiryRef = useRef(0);
  const preStrokeRef = useRef<ImageData | null>(null);
  const straightenedRef = useRef(false);
  const straightenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const straightenOriginRef = useRef<Pt | null>(null);
  const arcP0Ref = useRef<Pt | null>(null);
  const arcP2Ref = useRef<Pt | null>(null);
  const shapeStartRef = useRef<Pt | null>(null); // ellipse/rectangle tools: bounding-box corner where the drag began
  // Alt-to-bend: while a straight (pen) line is snapped, holding Option/Alt
  // locks the endpoint and turns the drag into curve-pen arc control; releasing
  // Alt reverts to the straight line. altDownRef = physical key state,
  // altCurveRef = currently bending, lastPointerRef = last drag position (so a
  // key press/release can redraw without waiting for a pointer move).
  const altDownRef = useRef(false);
  const altCurveRef = useRef(false);
  // When Alt is released the bowed edge is kept (not flattened): its through-
  // point is frozen here so the cursor no longer reshapes it, and a subsequent
  // hold/Shift locks the vertex at the curve's end with the curve preserved.
  const curveApexRef = useRef<Pt | null>(null);
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
  // Pen curve-cue ("yellow dot") stage: yellowTimerRef fires PEN_CURVE_CUE_DELAY
  // after settle to open the curve window; curveWindowRef is true while it's open
  // (a move then bends the line instead of locking a straight vertex).
  const yellowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const curveWindowRef = useRef(false);
  // Polygon fill: committed vertices of the shape being drawn. Each vertex holds
  // the control point (cp) of the curved edge leading into it, or null for a
  // straight edge. Index 0 is the start; the shape is auto-closed on lift.
  const fillVertsRef = useRef<{ x: number; y: number; cp: { x: number; y: number } | null }[]>([]);
  const shiftProcessedRef = useRef(false);
  // Prism tool: phase 1 ("draw") builds a polygon exactly like fill; on lift the
  // closed ring is parked in prismBaseRef and the tool auto-enters phase 2
  // ("extrude"), where a press-and-drag up/down duplicates the ring vertically
  // and connects the vertices with verticals. extrudeStartYRef is the y where the
  // extrude drag began; the live offset is (cursor.y − start.y).
  const prismPhaseRef = useRef<"draw" | "extrude">("draw");
  const prismBaseRef = useRef<{ x: number; y: number; cp: { x: number; y: number } | null }[]>([]);
  const extrudeStartYRef = useRef(0);
  // Canvas rect cached for the duration of a stroke. getBoundingClientRect()
  // forces a synchronous reflow, and it was being called for every coalesced
  // pointer sample (up to ~10×/move at 120Hz) — measure once per stroke instead.
  const rectRef = useRef<DOMRect | null>(null);
  // Pinch-zoom / pan view (fingers only; pencil draws). Applied as a CSS
  // transform on the image container — but ONLY while zoomed, so at rest the
  // drawing canvas is never GPU-promoted (which would reintroduce Pencil lag).
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const penDownRef = useRef(false); // pencil in contact → suppress finger gestures
  const touchesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ d0: number; scale0: number; cx: number; cy: number; lux: number; luy: number; m0x: number; m0y: number } | null>(null);
  const panRef = useRef<{ x0: number; y0: number; tx0: number; ty0: number } | null>(null);
  // Multi-finger tap detection: tapRef tracks the current touch sequence (peak
  // finger count + whether it moved); lastTapRef is the previous completed tap,
  // so two quick N-finger taps → undo (2 fingers) / redo (3 fingers).
  const tapRef = useRef<{ startT: number; maxFingers: number; moved: boolean } | null>(null);
  const lastTapRef = useRef({ n: 0, t: 0 });

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
    // A real resize/rotate resets any pinch-zoom (inline to keep setup dep-free).
    viewRef.current = { scale: 1, tx: 0, ty: 0 };
    if (container) container.style.transform = "";
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
      if (yellowTimerRef.current) clearTimeout(yellowTimerRef.current);
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
    redoStackRef.current = []; // a new action breaks the redo chain
  }
  function undo() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!ctx || !canvas || !undoStackRef.current.length) return;
    // Remember the current state so it can be redone.
    if (redoStackRef.current.length >= MAX_UNDO) redoStackRef.current.shift();
    redoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(undoStackRef.current.pop()!, 0, 0);
  }
  function redo() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!ctx || !canvas || !redoStackRef.current.length) return;
    if (undoStackRef.current.length >= MAX_UNDO) undoStackRef.current.shift();
    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.putImageData(redoStackRef.current.pop()!, 0, 0);
  }

  function getPos(e: PointerEvent): Pt {
    // rectRef is refreshed at each pointerdown; fall back only if a move somehow
    // arrives first. Avoids a reflow-inducing getBoundingClientRect per sample.
    // The rect already reflects any zoom transform; divide by scale to get local
    // (unzoomed) canvas coordinates so ink lands correctly while zoomed in.
    const rect = rectRef.current ?? canvasRef.current!.getBoundingClientRect();
    const s = viewRef.current.scale || 1;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s, pressure: e.pressure > 0 ? e.pressure : 0.5 };
  }

  // ── Pinch-zoom / pan (touch gestures) ─────────────────────────────────────
  function applyView() {
    const c = containerRef.current;
    if (!c) return;
    const v = viewRef.current;
    // No transform at rest → the canvas stays un-composited and Pencil-fast.
    if (v.scale <= 1.001 && Math.abs(v.tx) < 0.5 && Math.abs(v.ty) < 0.5) {
      c.style.transform = "";
    } else {
      c.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.scale})`;
    }
  }
  function clampView() {
    const v = viewRef.current;
    const body = bodyRef.current;
    if (!body) return;
    if (v.scale < 1) v.scale = 1;
    const { w, h } = lastSizeRef.current;
    // Keep the (zoomed) image covering the viewport — can't pan it off-screen.
    const maxTx = Math.max(0, (w * v.scale - body.clientWidth) / 2);
    const maxTy = Math.max(0, (h * v.scale - body.clientHeight) / 2);
    v.tx = Math.min(maxTx, Math.max(-maxTx, v.tx));
    v.ty = Math.min(maxTy, Math.max(-maxTy, v.ty));
  }
  function gestureDown(e: PointerEvent) {
    if (penDownRef.current) return; // pencil is drawing — ignore fingers
    e.preventDefault();
    const first = touchesRef.current.size === 0;
    touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const n = touchesRef.current.size;
    // Start / grow the tap candidate (peak finger count over the sequence).
    if (first) tapRef.current = { startT: e.timeStamp, maxFingers: 1, moved: false };
    else if (tapRef.current) tapRef.current.maxFingers = Math.max(tapRef.current.maxFingers, n);
    if (n === 2) {
      panRef.current = null;
      startPinch();
    } else if (n === 1) {
      const v = viewRef.current;
      panRef.current = { x0: e.clientX, y0: e.clientY, tx0: v.tx, ty0: v.ty };
    }
  }
  function gestureMove(e: PointerEvent) {
    if (!touchesRef.current.has(e.pointerId)) return;
    e.preventDefault();
    touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const n = touchesRef.current.size;
    if (n >= 2) {
      updatePinch();
    } else if (n === 1 && panRef.current) {
      const p = panRef.current;
      const dx = e.clientX - p.x0;
      const dy = e.clientY - p.y0;
      if (Math.hypot(dx, dy) > 10 && tapRef.current) tapRef.current.moved = true;
      if (viewRef.current.scale > 1.001) {
        viewRef.current.tx = p.tx0 + dx;
        viewRef.current.ty = p.ty0 + dy;
        clampView();
        applyView();
      }
    }
  }
  function gestureUp(e: PointerEvent) {
    const had = touchesRef.current.delete(e.pointerId);
    if (!had) return;
    if (touchesRef.current.size < 2) pinchRef.current = null;
    if (touchesRef.current.size > 0) return; // wait for all fingers to lift
    // All fingers up — evaluate the tap. A quick 2- or 3-finger tap with no
    // pan/pinch movement is a double-tap candidate (undo / redo respectively).
    const tap = tapRef.current;
    tapRef.current = null;
    panRef.current = null;
    if (!tap || tap.moved || e.timeStamp - tap.startT > 350) return;
    const n = tap.maxFingers;
    if (n !== 1 && n !== 2) return; // 1-finger double-tap = undo, 2-finger = redo
    const last = lastTapRef.current;
    if (last.n === n && e.timeStamp - last.t < 400) {
      if (n === 1) undo();
      else redo();
      navigator.vibrate?.(10);
      lastTapRef.current = { n: 0, t: 0 }; // consume so a 3rd tap doesn't re-fire
    } else {
      lastTapRef.current = { n, t: e.timeStamp };
    }
  }
  function startPinch() {
    const c = containerRef.current;
    const pts = [...touchesRef.current.values()];
    if (!c || pts.length < 2) return;
    const [a, b] = pts;
    const d0 = Math.hypot(a.x - b.x, a.y - b.y);
    const m0x = (a.x + b.x) / 2;
    const m0y = (a.y + b.y) / 2;
    const rect = c.getBoundingClientRect();
    const cx = (rect.left + rect.right) / 2; // transformed container center
    const cy = (rect.top + rect.bottom) / 2;
    const v = viewRef.current;
    // Layout center (constant) = transformed center − translate; the local point
    // under the pinch midpoint stays fixed as we scale.
    pinchRef.current = { d0, scale0: v.scale, cx: cx - v.tx, cy: cy - v.ty, lux: (m0x - cx) / v.scale, luy: (m0y - cy) / v.scale, m0x, m0y };
  }
  function updatePinch() {
    const p = pinchRef.current;
    const pts = [...touchesRef.current.values()];
    if (!p || pts.length < 2 || p.d0 < 1) return;
    const [a, b] = pts;
    const d1 = Math.hypot(a.x - b.x, a.y - b.y);
    const m1x = (a.x + b.x) / 2;
    const m1y = (a.y + b.y) / 2;
    // A real spread or drag disqualifies this as a tap (so 2/3-finger taps that
    // don't move still register as undo/redo).
    if (tapRef.current && (Math.abs(d1 - p.d0) > 12 || Math.hypot(m1x - p.m0x, m1y - p.m0y) > 12)) tapRef.current.moved = true;
    const v = viewRef.current;
    v.scale = Math.min(5, Math.max(1, p.scale0 * (d1 / p.d0)));
    v.tx = m1x - p.cx - p.lux * v.scale;
    v.ty = m1y - p.cy - p.luy * v.scale;
    clampView();
    applyView();
  }

  // Control point of the quadratic P0→P2 whose apex sits at the CHORD MIDPOINT,
  // bulging perpendicular to the P0→P2 line by Q's perpendicular distance from
  // it. The along-line position of Q is ignored, so the arch is always
  // symmetric (no skew). Returns null for a degenerate (zero-length) segment.
  function arcControlPoint(P0: Pt | { x: number; y: number }, P2: { x: number; y: number }, Q: { x: number; y: number }): { x: number; y: number } | null {
    const ax = P2.x - P0.x;
    const ay = P2.y - P0.y;
    const len2 = ax * ax + ay * ay;
    if (len2 < 1e-6) return null;
    const len = Math.sqrt(len2);
    // Unit perpendicular to the chord.
    const nx = -ay / len;
    const ny = ax / len;
    // Signed perpendicular distance of Q from the chord.
    const h = (Q.x - P0.x) * nx + (Q.y - P0.y) * ny;
    const mx = (P0.x + P2.x) / 2;
    const my = (P0.y + P2.y) / 2;
    // For a quadratic, B(0.5) = midpoint(M, CP); placing CP at 2h from the chord
    // midpoint M puts the apex at perpendicular distance h from the chord.
    return { x: mx + 2 * h * nx, y: my + 2 * h * ny };
  }

  // Dash pattern for the active line style, scaled to the stroke width so it
  // reads the same at any size. Dotted relies on the round line cap (set in
  // setup) to render the zero-length dashes as round dots. Freehand strokes are
  // drawn as many tiny segments and can't carry a dash phase, so they always use
  // [] (solid); the style shows on snapped lines, curves, and shape outlines.
  function dashFor(w: number): number[] {
    switch (lineStyleRef.current) {
      case "dashed":
        return [w * 2.6, w * 2];
      case "dotted":
        // Short on-segment + round cap ⇒ round dots; kept non-zero so it renders
        // reliably across browsers (the [0, gap] trick is culled by some).
        return [Math.max(1, w * 0.3), w * 1.8];
      default:
        return [];
    }
  }

  function drawArch(ctx: CanvasRenderingContext2D, P0: Pt, P2: Pt, Q: { x: number; y: number }) {
    const cp = arcControlPoint(P0, P2, Q);
    ctx.beginPath();
    ctx.moveTo(P0.x, P0.y);
    if (!cp) ctx.lineTo(P2.x, P2.y);
    else ctx.quadraticCurveTo(cp.x, cp.y, P2.x, P2.y);
    ctx.setLineDash(dashFor(ctx.lineWidth));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // True while the current stroke should behave like the fill polygon builder:
  // the fill tool itself, or the prism tool during its draw phase (before it
  // switches to extruding). Lets the fill logic serve both tools.
  function isFillDraw(): boolean {
    const t = toolRef.current;
    return t === "fill" || (t === "prism" && prismPhaseRef.current === "draw");
  }
  // Tools that use the yellow "curve window" before the blue vertex lock: the pen
  // (always), and the polygon fill / prism draw when their curve mode is on (the
  // toolbar toggle). A move during the window bows the edge instead of locking it
  // straight; with fill curve mode off, edges snap to fast hard corners instead.
  // The curve pen is excluded — it curves inherently and keeps its quicker lock.
  function usesCurveCue(): boolean {
    return toolRef.current === "pen" || (isFillDraw() && fillCurveModeRef.current);
  }

  // Ellipse tool: repaint the base, then stroke the ellipse inscribed in the
  // bounding box from the drag's start corner to `pos`. Honors color/size/style.
  function renderEllipse(pos: Pt) {
    const ctx = ctxRef.current;
    const start = shapeStartRef.current;
    if (!ctx || !preStrokeRef.current || !start) return;
    ctx.putImageData(preStrokeRef.current, 0, 0);
    const cx = (start.x + pos.x) / 2;
    const cy = (start.y + pos.y) / 2;
    const rx = Math.abs(pos.x - start.x) / 2;
    const ry = Math.abs(pos.y - start.y) / 2;
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = sizeRef.current * 1.5;
    ctx.setLineDash(dashFor(ctx.lineWidth));
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Rectangle tool: repaint the base, then stroke the rectangle spanning the
  // drag's start corner to `pos`. Honors color/size/style; miter for crisp corners.
  function renderRect(pos: Pt) {
    const ctx = ctxRef.current;
    const start = shapeStartRef.current;
    if (!ctx || !preStrokeRef.current || !start) return;
    ctx.putImageData(preStrokeRef.current, 0, 0);
    const x = Math.min(start.x, pos.x);
    const y = Math.min(start.y, pos.y);
    const w = Math.abs(pos.x - start.x);
    const h = Math.abs(pos.y - start.y);
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = sizeRef.current * 1.5;
    ctx.lineJoin = "miter";
    ctx.setLineDash(dashFor(ctx.lineWidth));
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.lineJoin = "round"; // restore global default for other tools
  }

  // Draw the active rubber-band shape (ellipse or rectangle) for the current box.
  function renderShape(pos: Pt) {
    if (toolRef.current === "rectangle") renderRect(pos);
    else renderEllipse(pos);
  }

  // Extrude preview: repaint the pre-polygon base, then stroke the base ring, a
  // copy offset vertically by `dy`, and a vertical connector at every vertex.
  // Wireframe only (no faces), re-rendered from the base each frame like the fill.
  function renderPrism(dy: number) {
    const ctx = ctxRef.current;
    if (!ctx || !preStrokeRef.current) return;
    const verts = prismBaseRef.current;
    if (verts.length < 2) return;
    ctx.putImageData(preStrokeRef.current, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = sizeRef.current * 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(dashFor(ctx.lineWidth));
    const traceRing = (oy: number) => {
      ctx.moveTo(verts[0].x, verts[0].y + oy);
      for (let i = 1; i < verts.length; i++) {
        const v = verts[i];
        if (v.cp) ctx.quadraticCurveTo(v.cp.x, v.cp.y + oy, v.x, v.y + oy);
        else ctx.lineTo(v.x, v.y + oy);
      }
      ctx.closePath();
    };
    ctx.beginPath();
    traceRing(0); // base ring
    ctx.stroke();
    ctx.beginPath();
    traceRing(dy); // extruded ring
    ctx.stroke();
    ctx.beginPath();
    for (const v of verts) {
      ctx.moveTo(v.x, v.y);
      ctx.lineTo(v.x, v.y + dy); // vertical connector
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Turn the in-progress fill polygon into a closed ring for extrusion. Appends
  // the final live-edge endpoint (honoring an in-progress/kept bow) so the ring
  // includes the last corner the user dragged to; skips it if it coincides with
  // the previous vertex.
  function finalizePrismRing(): { x: number; y: number; cp: { x: number; y: number } | null }[] {
    const verts = fillVertsRef.current;
    const q = lastPointerRef.current;
    if (q && verts.length >= 1) {
      const lastV = verts[verts.length - 1];
      const bent = (altCurveRef.current || curveApexRef.current != null) && arcP2Ref.current;
      const end = bent ? arcP2Ref.current! : q;
      const through = curveApexRef.current ?? q;
      const cp = bent && lastV ? arcControlPoint(lastV, arcP2Ref.current!, through) : null;
      if (!lastV || Math.hypot(end.x - lastV.x, end.y - lastV.y) > 2) {
        verts.push({ x: end.x, y: end.y, cp });
      }
    }
    return verts.slice();
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
    ctx.setLineDash(dashFor(ctx.lineWidth));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Redraw a snapped (straightened) stroke for a given pointer position: an arc
  // when the curve pen is active OR when Alt is bending a pen line, otherwise a
  // straight line whose endpoint follows the pointer.
  function redrawStraightened(pos: Pt) {
    const ctx = ctxRef.current;
    if (!ctx || !preStrokeRef.current) return;
    const t = toolRef.current;
    if (isFillDraw()) {
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
    const arcMode = t === "curvepen" || (t === "pen" && (altCurveRef.current || curveApexRef.current != null));
    if (arcMode && arcP0Ref.current && arcP2Ref.current) {
      // While bending, the cursor is the point the arc passes through (sets both
      // height and skew). Once Alt is released the through-point is frozen, so
      // the kept curve no longer follows the cursor.
      const through = curveApexRef.current ?? pos;
      drawArch(ctx, arcP0Ref.current, arcP2Ref.current, through);
    } else {
      const p1 = pointsRef.current[0];
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.setLineDash(t === "eraser" ? [] : dashFor(ctx.lineWidth));
      ctx.stroke();
      ctx.setLineDash([]);
      pointsRef.current[pointsRef.current.length - 1] = pos;
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // Enter Alt-bend: lock the current endpoint and set up the arc so the drag now
  // controls its bulge. Only meaningful for a snapped pen line.
  function engageAltCurve() {
    const tool = toolRef.current;
    if ((tool !== "pen" && !isFillDraw()) || !straightenedRef.current || altCurveRef.current) return;
    const pts = pointsRef.current;
    if (pts.length < 1) return;
    const P0 = pts[0];
    const P2 = pts[pts.length - 1]; // current endpoint = where the line ends now
    arcP0Ref.current = P0;
    arcP2Ref.current = { ...P2 };
    altCurveRef.current = true;
    curveApexRef.current = null; // live bending again — cursor drives the arc
    redrawStraightened(lastPointerRef.current ?? P2);
  }

  // Leave Alt-bend: KEEP the bowed curve, then drop the corner vertex right at
  // the curve's endpoint and open the next segment there. Committing on release
  // (rather than waiting for a follow-up hold) makes the vertex land reliably on
  // the endpoint and flashes the feedback pulse there. The old hold-after-release
  // path depended on a timer surviving the pointer stream, which on iPad could be
  // interrupted (a modifier keyup can coincide with a pointercancel), leaving the
  // vertex to fall on the cursor with no pulse.
  function disengageAltCurve() {
    if (!altCurveRef.current) return;
    altCurveRef.current = false;
    const end = arcP2Ref.current ?? lastPointerRef.current ?? pointsRef.current[pointsRef.current.length - 1];
    // Freeze the apex the user set so the final curve is repainted (not reverted
    // to a straight line) before we bake it into the committed segment.
    curveApexRef.current = lastPointerRef.current ?? end;
    lastPointerRef.current = end ?? null;
    if (end) redrawStraightened(end);
    // Pen and fill: releasing Alt keeps the curve AND drops the vertex at its
    // endpoint, starting the next segment/edge from there. commitPolygonVertex
    // sees the kept curve (curveApexRef set + arcP2Ref set) and anchors on arcP2
    // with the bow preserved, not a straight edge to the cursor.
    const t = toolRef.current;
    if ((t === "pen" || isFillDraw()) && end && strokeActiveRef.current) {
      commitPolygonVertex();
    }
  }

  // Press/release the Option/Alt modifier. Shared by the physical Alt key and
  // the physical Option/Alt key (keyboard users). Press bends a snapped
  // pen/fill/prism line into a curve; release keeps the curve and drops the
  // vertex at its end. If pressed before the line has snapped, the snap
  // (straighten) engages the bend then, matching the key. Keyboardless users get
  // the same result via the pen/fill yellow curve window.
  function pressAlt() {
    if (altDownRef.current) return; // already down — ignore key repeat / re-press
    altDownRef.current = true;
    if (straightenedRef.current && (toolRef.current === "pen" || isFillDraw()) && !altCurveRef.current) {
      engageAltCurve();
    }
  }
  function releaseAlt() {
    if (!altDownRef.current) return;
    altDownRef.current = false;
    if (altCurveRef.current) disengageAltCurve();
  }

  // Show a brief pulse at a just-dropped vertex (visual counterpart to the
  // haptic tick). Purely a DOM overlay — never touches the canvas.
  function flashVertex(x: number, y: number) {
    setPulses((p) => [...p, { id: crypto.randomUUID(), x, y }]);
  }

  // Polygon: drop a vertex mid-stroke. Bake the current segment (snapping a
  // still-freehand one to a straight line first), then start a new segment from
  // that endpoint so the drag continues the shape. Lifting the pointer ends it.
  function commitPolygonVertex() {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    const tool = toolRef.current;
    if (!ctx || !canvas || (tool !== "pen" && tool !== "curvepen" && !isFillDraw()) || !strokeActiveRef.current) return;
    if (pointsRef.current.length < 1) return;
    if (straightenTimerRef.current) {
      clearTimeout(straightenTimerRef.current);
      straightenTimerRef.current = null;
    }
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
    closeCurveWindow(); // committing supersedes any pending yellow cue
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
      flashVertex(endpoint.x, endpoint.y);
      navigator.vibrate?.(8);
      return;
    }

    // Fill: append the current edge's endpoint (and its curve control point) to
    // the shape, then start the next edge there. No pixel bake — the whole fill
    // is re-rendered from the pre-stroke base each frame.
    if (isFillDraw()) {
      const lastV = fillVertsRef.current[fillVertsRef.current.length - 1];
      // Bent while Alt is held (curveApex null, cursor is the through-point) OR a
      // kept curve after Alt release (curveApex frozen). Either way anchor on the
      // curve's endpoint and bow through the apex, not a straight edge to the cursor.
      const bent = (altCurveRef.current || curveApexRef.current != null) && arcP2Ref.current;
      const endpoint: Pt = bent ? { ...arcP2Ref.current! } : { ...pos };
      const through = curveApexRef.current ?? pos;
      const cp = bent ? arcControlPoint(lastV, arcP2Ref.current!, through) : null;
      fillVertsRef.current.push({ x: endpoint.x, y: endpoint.y, cp });
      pointsRef.current = [{ ...endpoint }, { ...endpoint }];
      straightenedRef.current = true;
      altCurveRef.current = false;
      curveApexRef.current = null;
      arcP0Ref.current = null;
      arcP2Ref.current = null;
      lastPointerRef.current = { ...endpoint };
      // Anchor the hold-origin here so staying still doesn't immediately drop a
      // second corner; moving away re-arms the timer.
      lockOriginRef.current = { ...endpoint };
      renderFill(endpoint, false);
      flashVertex(endpoint.x, endpoint.y);
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
    // A bowed edge (being bent, or a kept curve after Alt release) ends at its
    // locked endpoint; a straight edge ends at the cursor.
    const bent = (altCurveRef.current || curveApexRef.current != null) && arcP2Ref.current;
    const endpoint: Pt = bent ? { ...arcP2Ref.current! } : { ...pos };
    // Freeze everything drawn so far; it's the base the next segment redraws on.
    preStrokeRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Begin the next segment at this vertex (two points so redraws update the
    // endpoint, not the anchor).
    pointsRef.current = [endpoint, { ...endpoint }];
    straightenedRef.current = true;
    altCurveRef.current = false;
    curveApexRef.current = null;
    arcP0Ref.current = null;
    arcP2Ref.current = null;
    lastPointerRef.current = { ...endpoint };
    // Don't re-arm the hold-to-lock timer here (that would drop repeated
    // vertices while holding at the same spot). Moving away re-arms it.
    lockOriginRef.current = { ...endpoint };
    flashVertex(endpoint.x, endpoint.y);
    navigator.vibrate?.(8);
    // If Alt is still held, bend the new segment as soon as the drag moves.
  }

  // Close the pen curve window: stop the yellow-cue timer and hide the dot.
  function closeCurveWindow() {
    if (yellowTimerRef.current) {
      clearTimeout(yellowTimerRef.current);
      yellowTimerRef.current = null;
    }
    curveWindowRef.current = false;
    setCurveCue((c) => (c ? null : c));
  }
  // Re-arm the "hold in place to drop a vertex" timer. For the cue tools (pen /
  // polygon fill) this also (re)starts the yellow curve-cue that precedes the
  // blue lock, so a move during that window bends the edge instead of locking it
  // straight. Other tools (curve pen) keep the quicker VERTEX_LOCK_DELAY.
  function armLockTimer(pos: Pt) {
    lockOriginRef.current = pos;
    const cue = usesCurveCue();
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    const blueDelay = cue ? PEN_VERTEX_LOCK_DELAY : VERTEX_LOCK_DELAY;
    lockTimerRef.current = setTimeout(lockVertex, blueDelay);
    // Restart the yellow stage for a straight cue-tool edge (not while bending).
    closeCurveWindow();
    if (cue && !altCurveRef.current) {
      yellowTimerRef.current = setTimeout(showYellow, PEN_CURVE_CUE_DELAY);
    }
  }
  function clearLockTimer() {
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
    lockOriginRef.current = null;
    closeCurveWindow();
  }
  // Yellow cue fires: open the curve window and show the dot at the endpoint. A
  // move now bends the line; holding still lets the blue lock fire next.
  function showYellow() {
    yellowTimerRef.current = null;
    if (!usesCurveCue() || !straightenedRef.current || !strokeActiveRef.current || altCurveRef.current) return;
    curveWindowRef.current = true;
    const p = lockOriginRef.current ?? lastPointerRef.current;
    if (p) setCurveCue({ x: p.x, y: p.y });
    navigator.vibrate?.(6);
  }
  // Fired once the pointer has been held still long enough after a segment
  // formed (pen line snapped / fill edge / curve smoothed): drop a vertex and
  // start the next segment (same effect as tapping Shift). For pen/fill the Alt
  // hold suppresses it (you release Alt then hold to lock); the curve pen has no
  // bend, so its long-hold lock is never suppressed.
  function lockVertex() {
    lockTimerRef.current = null;
    closeCurveWindow(); // blue lock supersedes the yellow cue
    const t = toolRef.current;
    if (altDownRef.current && t !== "curvepen") return;
    if ((t !== "pen" && t !== "curvepen" && !isFillDraw()) || !straightenedRef.current || !strokeActiveRef.current) return;
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
      ctx.setLineDash(t === "eraser" ? [] : dashFor(ctx.lineWidth));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = "source-over";
    }
    straightenedRef.current = true;
    navigator.vibrate?.(12);
    // If Option/Alt is already held when the pen line snaps, start bending now.
    if (toolRef.current === "pen" && altDownRef.current) engageAltCurve();
    // Pen & curve pen: begin the "hold in place to drop a vertex" countdown now
    // that the segment has formed. Continuing to hold locks the vertex and starts
    // the next segment (chaining); moving re-arms it. For the curve pen this lets
    // you chain another curve with a long hold — no Shift/keyboard needed.
    if (toolRef.current === "pen" || toolRef.current === "curvepen") armLockTimer(pts[pts.length - 1]);
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

    // Prism phase 2: a second press-and-drag extrudes the finished polygon.
    // Reuse the phase-1 undo snapshot (no new saveUndo) so the whole prism is a
    // single undo step, and keep preStrokeRef (the pre-polygon image) to redraw on.
    if (toolRef.current === "prism" && prismPhaseRef.current === "extrude") {
      const pos = getPos(e);
      extrudeStartYRef.current = pos.y;
      lastPointerRef.current = pos;
      strokeActiveRef.current = true;
      renderPrism(0);
      return;
    }

    if (straightenTimerRef.current) clearTimeout(straightenTimerRef.current);
    clearLockTimer();
    straightenedRef.current = false;
    preStrokeRef.current = null;
    straightenOriginRef.current = null;
    arcP0Ref.current = null;
    arcP2Ref.current = null;
    altCurveRef.current = false;
    curveApexRef.current = null;
    lastPointerRef.current = null;
    saveUndo();
    preStrokeRef.current = undoStackRef.current[undoStackRef.current.length - 1];
    const pos = getPos(e);
    if (toolRef.current === "ellipse" || toolRef.current === "rectangle") {
      // Rubber-band from this corner; the drag sizes/shapes the ellipse/rectangle.
      shapeStartRef.current = pos;
      pointsRef.current = [pos, { ...pos }];
      strokeActiveRef.current = true;
      renderShape(pos);
      return;
    }
    if (isFillDraw()) {
      // Fill/prism edges are straight from the start (no freehand/snap); Shift or
      // a hold-in-place drops vertices, Alt bows an edge. Fill closes+fills on
      // lift; prism parks the ring and enters its extrude phase.
      fillVertsRef.current = [{ x: pos.x, y: pos.y, cp: null }];
      pointsRef.current = [pos, { ...pos }];
      strokeActiveRef.current = true;
      straightenedRef.current = true;
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = colorRef.current;
      ctx.fillStyle = colorRef.current;
      renderFill(pos, false);
      // No hold-timer yet: the first edge has zero length until the pointer
      // moves. onPointerMove arms it once the user drags out an edge, so holding
      // still then drops the corner (same as pen). Shift still works too.
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
    ctx.setLineDash([]); // freehand is always solid (per-segment dashing can't hold a phase)
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

    // Prism extrude drag: vertical distance from the press sets the extrusion.
    if (toolRef.current === "prism" && prismPhaseRef.current === "extrude") {
      if (e.pointerType === "pen") penExpiryRef.current = e.timeStamp + PEN_LOCK;
      e.preventDefault();
      const pos = getPos(e);
      lastPointerRef.current = pos;
      renderPrism(pos.y - extrudeStartYRef.current);
      return;
    }

    // Ellipse rubber-band: redraw the ellipse for the current bounding box.
    if (toolRef.current === "ellipse" || toolRef.current === "rectangle") {
      if (e.pointerType === "pen") penExpiryRef.current = e.timeStamp + PEN_LOCK;
      e.preventDefault();
      const pos = getPos(e);
      lastPointerRef.current = pos;
      renderShape(pos);
      return;
    }

    if (!pointsRef.current.length) return;
    if (e.pointerType === "pen") penExpiryRef.current = e.timeStamp + PEN_LOCK;
    e.preventDefault();

    if (straightenedRef.current) {
      const pos = getPos(e);
      // Cue tools (pen / polygon fill): a deliberate move while the yellow curve
      // window is open bends the edge instead of nudging the straight endpoint.
      // The blue lock is cancelled and re-armed (below) so it fires on the NEXT
      // settle — now locking the curved vertex. >4px ignores Apple Pencil jitter.
      if (usesCurveCue() && curveWindowRef.current && !altCurveRef.current) {
        const o = lockOriginRef.current;
        if (!o || Math.hypot(pos.x - o.x, pos.y - o.y) > 4) {
          closeCurveWindow();
          if (lockTimerRef.current) {
            clearTimeout(lockTimerRef.current);
            lockTimerRef.current = null;
          }
          engageAltCurve();
        }
      }
      lastPointerRef.current = pos;
      // If the Alt modifier (key or on-screen Bend button) is held but the bend
      // hasn't engaged yet, engage now — so holding Bend and then moving the
      // pencil bows the line even if the exact press-moment timing was missed
      // (and for fill/prism, which have no snap event to engage on).
      if (altDownRef.current && !altCurveRef.current && (toolRef.current === "pen" || isFillDraw())) {
        engageAltCurve();
      }
      redrawStraightened(pos);
      // Pen/fill/curve: while adjusting the segment (curve pen: shaping the arc's
      // bulge), re-arm the hold-to-lock timer on real movement so it only fires
      // once you settle on a spot.
      if (toolRef.current === "pen" || toolRef.current === "curvepen" || isFillDraw()) {
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
    if (toolRef.current === "ellipse" || toolRef.current === "rectangle") {
      // The last renderShape left the shape on the canvas; just clear state.
      shapeStartRef.current = null;
      pointsRef.current = [];
      preStrokeRef.current = null;
      ctx.globalCompositeOperation = "source-over";
      return;
    }
    if (toolRef.current === "prism") {
      if (prismPhaseRef.current === "draw") {
        // Phase 1 done: close the polygon into a ring and auto-enter extrude.
        const ring = finalizePrismRing();
        fillVertsRef.current = [];
        pointsRef.current = [];
        straightenedRef.current = false;
        altCurveRef.current = false;
        curveApexRef.current = null;
        arcP0Ref.current = null;
        arcP2Ref.current = null;
        lastPointerRef.current = null;
        if (ring.length >= 2 && preStrokeRef.current) {
          prismBaseRef.current = ring;
          prismPhaseRef.current = "extrude";
          renderPrism(0); // show the flat polygon; a press-drag now extrudes it
        } else {
          // Not enough for a prism (e.g. a stray tap) — discard, nothing baked.
          prismBaseRef.current = [];
          if (preStrokeRef.current) ctx.putImageData(preStrokeRef.current, 0, 0);
          preStrokeRef.current = null;
        }
        ctx.globalCompositeOperation = "source-over";
        return;
      }
      // Phase 2 done: the last renderPrism left the final prism on the canvas.
      prismBaseRef.current = [];
      prismPhaseRef.current = "draw";
      preStrokeRef.current = null;
      lastPointerRef.current = null;
      ctx.globalCompositeOperation = "source-over";
      return;
    }
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
      curveApexRef.current = null;
      lastPointerRef.current = null;
      ctx.globalCompositeOperation = "source-over";
      return;
    }
    // A leftover single point becomes a dot (a deliberate tap) — except for the
    // curve pen, where a 1-point segment is just the start the last lock chained
    // to; lifting there should leave the drawn curve, not a stray dot.
    if (pointsRef.current.length === 1 && toolRef.current !== "text" && toolRef.current !== "curvepen") {
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
    // Abandon a pending prism extrude when switching tools: the flat polygon is
    // already on the canvas; just drop the extrude state so it doesn't carry over.
    if (prismPhaseRef.current === "extrude") {
      prismPhaseRef.current = "draw";
      prismBaseRef.current = [];
      preStrokeRef.current = null;
    }
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
  const handlersRef = useRef({
    down: onPointerDown,
    move: onPointerMove,
    up: onPointerUp,
    gDown: gestureDown,
    gMove: gestureMove,
    gUp: gestureUp,
  });
  useEffect(() => {
    handlersRef.current = {
      down: onPointerDown,
      move: onPointerMove,
      up: onPointerUp,
      gDown: gestureDown,
      gMove: gestureMove,
      gUp: gestureUp,
    };
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Pencil (and mouse) draw; fingers (touch) run pan/zoom/undo gestures. This
    // is the split the user wants: pencil for ink, fingers for navigation.
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* fast tap: capture optional */
        }
        handlersRef.current.gDown(e);
        return;
      }
      if (e.pointerType === "pen") {
        penDownRef.current = true;
        // Abandon any in-progress finger gesture the moment the pencil draws.
        touchesRef.current.clear();
        pinchRef.current = null;
        panRef.current = null;
      }
      canvas.setPointerCapture(e.pointerId);
      handlersRef.current.down(e);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        handlersRef.current.gMove(e);
        return;
      }
      if (e.buttons) handlersRef.current.move(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        handlersRef.current.gUp(e);
        return;
      }
      if (e.pointerType === "pen") penDownRef.current = false;
      handlersRef.current.up(e);
    };
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
  const keyApiRef = useRef({ pressAlt, releaseAlt, commit: commitPolygonVertex });
  useEffect(() => {
    keyApiRef.current = { pressAlt, releaseAlt, commit: commitPolygonVertex };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        if (e.repeat) return; // pressAlt is idempotent, but skip the churn
        e.preventDefault();
        keyApiRef.current.pressAlt();
      } else if (e.key === "Shift") {
        if (shiftProcessedRef.current) return; // ignore key auto-repeat
        shiftProcessedRef.current = true;
        const t = toolRef.current;
        if ((t === "pen" || t === "curvepen" || isFillDraw()) && strokeActiveRef.current && pointsRef.current.length >= 1) {
          e.preventDefault();
          keyApiRef.current.commit();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        keyApiRef.current.releaseAlt();
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
        <span className={styles.title}>Annotate Photo</span>
      </div>

      <div className={styles.main}>
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
          {pulses.map((p) => (
            <div
              key={p.id}
              className={styles.vertexPulse}
              style={{ left: p.x, top: p.y }}
              onAnimationEnd={() => setPulses((cur) => cur.filter((pp) => pp.id !== p.id))}
            />
          ))}
          {curveCue && <div className={styles.curveCue} style={{ left: curveCue.x, top: curveCue.y }} />}
        </div>
        {!ready && !loadError && <div className={styles.spinner}>Loading…</div>}
        {loadError && <div className={styles.spinner}>Couldn’t load the photo.</div>}
      </div>

      <div className={styles.toolbar}>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "pen" ? styles.active : ""}`}
          title="Pen — hold still to snap to a straight line; keep holding in place to drop a polygon vertex (or tap Shift); hold Option/Alt to bow an edge, release to keep the curve and drop the vertex at its end"
          onClick={() => selectTool("pen")}
        >
          <Ico name="pen" />
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "curvepen" ? styles.active : ""}`}
          title="Curve pen — draw and hold still to smooth into a curve, optionally drag to shape it, then keep holding in place to lock it and chain another curve (or tap Shift)"
          onClick={() => selectTool("curvepen")}
        >
          <Ico name="curve" />
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "text" ? styles.active : ""} ${tool === "text" && textMode === "move" ? styles.textMove : ""}`}
          title="Text label (tap again to toggle move mode)"
          onClick={onTextButton}
        >
          <Ico name="text" />
        </button>
        <button type="button" className={`${styles.toolBtn} ${tool === "eraser" ? styles.active : ""}`} title="Eraser" onClick={() => selectTool("eraser")}>
          <Ico name="eraser" />
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "fill" ? styles.active : ""}`}
          title="Polygon fill — draw an edge, hold still in place (or tap Shift) to drop corners, hold Option/Alt to bow an edge and release to keep the curve and drop the corner, lift to close and fill"
          onClick={() => selectTool("fill")}
        >
          <Ico name="fill" />
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "prism" ? styles.active : ""}`}
          title="Prism — draw a polygon like fill (hold/Shift for corners, Option/Alt to bow), lift to finish, then press and drag up or down to extrude it into a prism"
          onClick={() => selectTool("prism")}
        >
          <Ico name="prism" />
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "ellipse" ? styles.active : ""}`}
          title="Ellipse — drag a box (e.g. upper-left to lower-right) to size and shape a circle/ellipse"
          onClick={() => selectTool("ellipse")}
        >
          <Ico name="ellipse" />
        </button>
        <button
          type="button"
          className={`${styles.toolBtn} ${tool === "rectangle" ? styles.active : ""}`}
          title="Rectangle — drag a box (e.g. upper-left to lower-right) to size a rectangle"
          onClick={() => selectTool("rectangle")}
        >
          <Ico name="rect" />
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
        <div className={styles.sep} />
        {LINE_STYLES.map((ls) => (
          <button
            key={ls.key}
            type="button"
            className={`${styles.sizeBtn} ${lineStyle === ls.key ? styles.active : ""}`}
            title={ls.label}
            onClick={() => setLineStyle(ls.key)}
          >
            <span className={styles.lineGlyph} style={{ borderTopStyle: ls.css }} />
          </button>
        ))}
        {(tool === "fill" || tool === "prism") && (
          <>
            <div className={styles.sep} />
            <button
              type="button"
              className={`${styles.modeToggle} ${fillCurveMode ? styles.active : ""}`}
              aria-pressed={fillCurveMode}
              title={
                fillCurveMode
                  ? "Edge mode: Curves — after an edge settles, a yellow cue lets you move to bow it. Tap for fast hard corners."
                  : "Edge mode: Corners — edges snap to fast straight corners. Tap to enable the curve window."
              }
              onClick={() => setFillCurveMode((m) => !m)}
            >
              {fillCurveMode ? "◠ Curves" : "∟ Corners"}
            </button>
          </>
        )}
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
        <button type="button" className={styles.utilBtn} title="Add image / sticker" onClick={() => fileInputRef.current?.click()}>
          <Ico name="add" />
        </button>
        <button type="button" className={styles.utilBtn} title="Undo (or one-finger double-tap)" onClick={undo}>
          <Ico name="undo" />
        </button>
        <button type="button" className={styles.utilBtn} title="Redo (or two-finger double-tap)" onClick={redo}>
          <Ico name="redo" />
        </button>
        {/* Finish controls live in the toolbar so they're always visible beside
            the tools (the top header can sit under iPad Safari's own toolbar). */}
        <div className={styles.sep} />
        <button type="button" className={styles.panelSave} onClick={save} disabled={saving || !ready}>
          {saving ? "Saving…" : "✓ Save & Close"}
        </button>
        <button type="button" className={styles.panelCancel} onClick={onClose} disabled={saving}>
          Cancel
        </button>
      </div>
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
