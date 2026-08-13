import { useRef, useEffect, useState } from 'react';

// ── Plant types (exported so PlanView + PlanShapeList can share) ─────────────

export const PLANT_TYPES = [
  { key: 'shade-tree', label: 'Shade Tree', symbol: '🌳' },
  { key: 'evergreen',  label: 'Evergreen',  symbol: '🌲' },
  { key: 'shrub',      label: 'Shrub',      symbol: '🌿' },
  { key: 'perennial',  label: 'Perennial',  symbol: '🌸' },
];

const PLANT_HIT_RADIUS = { 'shade-tree': 24, 'evergreen': 20, 'shrub': 14, 'perennial': 11 };

// ── Item types (exported so PlanView + PlanShapeList + CatalogEditor can share) ──

export const ITEM_TYPES = [
  { key: 'star',        label: 'Star',        symbol: '★' },
  { key: 'arrow-left',  label: 'Arrow Left',  symbol: '◄' },
  { key: 'arrow-right', label: 'Arrow Right', symbol: '►' },
  { key: 'arrow-up',    label: 'Arrow Up',    symbol: '▲' },
  { key: 'arrow-down',  label: 'Arrow Down',  symbol: '▼' },
];

const ITEM_HIT_RADIUS = 16;
const PIN_HIT_RADIUS = 16;
// Grab radii (canvas px) for editing a plotted shape's nodes in select mode.
const VERTEX_GRAB_RADIUS = 13;
const MIDPOINT_GRAB_RADIUS = 11;

// A linked-photo pin (photo icon in a circle).
function drawPhotoPin(ctx, x, y) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#4f46e5';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  // tiny photo glyph
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 5, y - 3.5, 10, 7);
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(x - 4, y - 2.5, 8, 5);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x - 1.5, y - 0.3, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Plant drawing ─────────────────────────────────────────────────────────────

function drawPlant(ctx, plantType, x, y, ghost = false) {
  ctx.globalAlpha = ghost ? 0.45 : 1;

  switch (plantType) {
    case 'shade-tree': {
      const r = 22;
      ctx.fillStyle = 'rgba(74,222,128,0.18)';
      ctx.strokeStyle = '#166534';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // Center dot
      ctx.fillStyle = '#166534';
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      // 4 short radial ticks
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 - Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * (r * 0.55), y + Math.sin(a) * (r * 0.55));
        ctx.lineTo(x + Math.cos(a) * (r * 0.85), y + Math.sin(a) * (r * 0.85));
        ctx.stroke();
      }
      break;
    }
    case 'evergreen': {
      const h = 36, hw = 15;
      ctx.fillStyle = '#14532d';
      ctx.strokeStyle = '#052e16';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - h * 0.62);
      ctx.lineTo(x + hw, y + h * 0.38);
      ctx.lineTo(x - hw, y + h * 0.38);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'shrub': {
      const r = 13;
      ctx.fillStyle = 'rgba(134,239,172,0.3)';
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // X mark
      const d = r * 0.45;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - d, y - d); ctx.lineTo(x + d, y + d);
      ctx.moveTo(x + d, y - d); ctx.lineTo(x - d, y + d);
      ctx.stroke();
      break;
    }
    case 'perennial': {
      const r = 6, petals = 5;
      ctx.fillStyle = '#a21caf';
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fde047';
      ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    default: break;
  }
  ctx.globalAlpha = 1;
}

function drawPlantSelected(ctx, plantType, x, y) {
  const r = (PLANT_HIT_RADIUS[plantType] ?? 16) + 6;
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}

// ── Item drawing ──────────────────────────────────────────────────────────────

function drawItem(ctx, itemType, x, y, ghost = false) {
  ctx.globalAlpha = ghost ? 0.45 : 1;
  ctx.fillStyle = '#f59e0b';
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 1.5;

  switch (itemType) {
    case 'star': {
      const r = 12, ir = 5, n = 5;
      ctx.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const angle = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
        const radius = i % 2 === 0 ? r : ir;
        if (i === 0) ctx.moveTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        else ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'arrow-left': {
      const s = 12;
      ctx.beginPath();
      ctx.moveTo(x + s,      y - s * 0.35);
      ctx.lineTo(x,          y - s * 0.35);
      ctx.lineTo(x,          y - s * 0.65);
      ctx.lineTo(x - s,      y);
      ctx.lineTo(x,          y + s * 0.65);
      ctx.lineTo(x,          y + s * 0.35);
      ctx.lineTo(x + s,      y + s * 0.35);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'arrow-right': {
      const s = 12;
      ctx.beginPath();
      ctx.moveTo(x - s,      y - s * 0.35);
      ctx.lineTo(x,          y - s * 0.35);
      ctx.lineTo(x,          y - s * 0.65);
      ctx.lineTo(x + s,      y);
      ctx.lineTo(x,          y + s * 0.65);
      ctx.lineTo(x,          y + s * 0.35);
      ctx.lineTo(x - s,      y + s * 0.35);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'arrow-up': {
      const s = 12;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.35, y + s);
      ctx.lineTo(x - s * 0.35, y);
      ctx.lineTo(x - s * 0.65, y);
      ctx.lineTo(x,            y - s);
      ctx.lineTo(x + s * 0.65, y);
      ctx.lineTo(x + s * 0.35, y);
      ctx.lineTo(x + s * 0.35, y + s);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'arrow-down': {
      const s = 12;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.35, y - s);
      ctx.lineTo(x - s * 0.35, y);
      ctx.lineTo(x - s * 0.65, y);
      ctx.lineTo(x,            y + s);
      ctx.lineTo(x + s * 0.65, y);
      ctx.lineTo(x + s * 0.35, y);
      ctx.lineTo(x + s * 0.35, y - s);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    default: break;
  }
  ctx.globalAlpha = 1;
}

function drawItemSelected(ctx, x, y) {
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(x, y, ITEM_HIT_RADIUS + 6, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

function getTransform(imageWidth, imageHeight, canvasWidth, canvasHeight) {
  if (!imageWidth || !imageHeight || !canvasWidth || !canvasHeight) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  return { scale, offsetX: (canvasWidth - imageWidth * scale) / 2, offsetY: (canvasHeight - imageHeight * scale) / 2 };
}

function toCanvas(pt, t) { return { x: pt.x * t.scale + t.offsetX, y: pt.y * t.scale + t.offsetY }; }
function fromCanvas(pt, t) { return { x: (pt.x - t.offsetX) / t.scale, y: (pt.y - t.offsetY) / t.scale }; }
function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
function centroid(pts) {
  const n = pts.length;
  if (!n) return { x: 0, y: 0 };
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
}
function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : { r: 99, g: 102, b: 241 };
}
function pointInPolygon(pt, verts) {
  let inside = false;
  const n = verts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = verts[i].x, yi = verts[i].y, xj = verts[j].x, yj = verts[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (!lenSq) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}
function drawLabel(ctx, text, x, y, color) {
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlanCanvas({
  plan, groups, activeTool, showCalLine, showMeasurements = true,
  catalogPlants, selectedPlantId, onPlantIdChange, onAddPlant, onRemovePlant,
  catalogItems, selectedItemCatalogId, onItemCatalogIdChange, onAddItemPlacement, onRemoveItemPlacement,
  onCalibrationPointsSet, onShapeComplete, onUpdateShape, onRemoveShape,
  photoPins = [], placingPhoto = false, onPlacePhotoPin, onOpenPhotoPin,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const inProgressRef = useRef([]);
  const lastClickTimeRef = useRef(0);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [inProgressVertices, setInProgressVertices] = useState([]);
  const [cursorPos, setCursorPos] = useState(null);
  const [calPoints, setCalPoints] = useState([]);
  const [selectedShapeId, setSelectedShapeId] = useState(null);
  const [selectedPlantInstanceId, setSelectedPlantInstanceId] = useState(null);
  const [selectedItemInstanceId, setSelectedItemInstanceId] = useState(null);
  const [imageReady, setImageReady] = useState(false);
  // Active node edit in select mode: { kind:'vertex'|'shape', shapeId, index, origVertices, startImg }
  const dragRef = useRef(null);
  // A drag ends with a synthetic click; swallow it so it doesn't re-select.
  const suppressClickRef = useRef(false);

  useEffect(() => { inProgressRef.current = []; setInProgressVertices([]); setCursorPos(null); }, [activeTool]);
  useEffect(() => { if (plan.scale) setCalPoints([]); }, [plan.scale]);
  useEffect(() => {
    if (selectedShapeId && !plan.shapes.find(s => s.id === selectedShapeId)) setSelectedShapeId(null);
  }, [plan.shapes, selectedShapeId]);
  useEffect(() => {
    if (selectedPlantInstanceId && !plan.plants.find(p => p.id === selectedPlantInstanceId)) setSelectedPlantInstanceId(null);
  }, [plan.plants, selectedPlantInstanceId]);
  useEffect(() => {
    if (selectedItemInstanceId && !(plan.items ?? []).find(p => p.id === selectedItemInstanceId)) setSelectedItemInstanceId(null);
  }, [plan.items, selectedItemInstanceId]);

  useEffect(() => {
    if (!plan.imageDataUrl) { imageRef.current = null; setImageReady(false); return; }
    setImageReady(false);
    const img = new Image();
    img.onload = () => { imageRef.current = img; setImageReady(true); };
    img.src = plan.imageDataUrl;
  }, [plan.imageDataUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize({ width, height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ── Draw ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = canvasSize.width  || canvas.offsetWidth  || 100;
    canvas.height = canvasSize.height || canvas.offsetHeight || 100;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!imageRef.current) {
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Upload a plan image to get started', canvas.width / 2, canvas.height / 2);
      return;
    }

    const t = getTransform(plan.imageWidth, plan.imageHeight, canvas.width, canvas.height);
    ctx.drawImage(imageRef.current, t.offsetX, t.offsetY, plan.imageWidth * t.scale, plan.imageHeight * t.scale);

    // Calibration line from stored scale
    if (plan.scale && showCalLine) {
      const cp0 = toCanvas(plan.scale.p1, t), cp1 = toCanvas(plan.scale.p2, t);
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cp0.x, cp0.y); ctx.lineTo(cp1.x, cp1.y); ctx.stroke();
      [cp0, cp1].forEach(p => { ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); });
      drawLabel(ctx, plan.scale.label, (cp0.x + cp1.x) / 2, (cp0.y + cp1.y) / 2 - 10, '#b45309');
    }

    // In-progress calibration points
    if (calPoints.length >= 1) {
      const cp0 = toCanvas(calPoints[0], t);
      ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(cp0.x, cp0.y, 6, 0, Math.PI * 2); ctx.fill();
      if (calPoints.length === 2) {
        const cp1 = toCanvas(calPoints[1], t);
        ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cp0.x, cp0.y); ctx.lineTo(cp1.x, cp1.y); ctx.stroke();
        ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(cp1.x, cp1.y, 6, 0, Math.PI * 2); ctx.fill();
      } else if (cursorPos) {
        const cursor = toCanvas(cursorPos, t);
        ctx.strokeStyle = 'rgba(245,158,11,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(cp0.x, cp0.y); ctx.lineTo(cursor.x, cursor.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Completed shapes
    for (const shape of plan.shapes) {
      if (shape.vertices.length < 1) continue;
      const pts = shape.vertices.map(v => toCanvas(v, t));
      const isSelected = shape.id === selectedShapeId;
      const rgb = hexToRgb(shape.color);
      ctx.strokeStyle = shape.color; ctx.lineWidth = isSelected ? 3.5 : 2;
      if (shape.type === 'area' && pts.length >= 3) {
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath();
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.18)`; ctx.fill(); ctx.stroke();
        const c = centroid(pts);
        if (showMeasurements) drawLabel(ctx, `${Math.round(shape.measurement).toLocaleString()} sq ft`, c.x, c.y, shape.color);
        if (shape.groupId) { const g = groups.find(gr => gr.id === shape.groupId); if (g) drawLabel(ctx, g.label, c.x, c.y + (showMeasurements ? 18 : 0), shape.color); }
      } else if (shape.type === 'linear' && pts.length >= 2) {
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
        const mid = pts[Math.floor(pts.length / 2)];
        if (showMeasurements) drawLabel(ctx, `${Math.round(shape.measurement).toLocaleString()} ln ft`, mid.x, mid.y - 10, shape.color);
        if (shape.groupId) { const g = groups.find(gr => gr.id === shape.groupId); if (g) drawLabel(ctx, g.label, mid.x, mid.y + (showMeasurements ? 6 : -10), shape.color); }
      }
      if (isSelected) {
        // Midpoint "add a node" handles (hollow with a + glyph)…
        const segCount = shape.type === 'area' ? pts.length : pts.length - 1;
        for (let j = 0; j < segCount; j++) {
          const a = pts[j], b = pts[(j + 1) % pts.length];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.strokeStyle = shape.color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(mx, my, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(mx - 2, my); ctx.lineTo(mx + 2, my); ctx.moveTo(mx, my - 2); ctx.lineTo(mx, my + 2); ctx.stroke();
        }
        // …and the draggable vertex handles on top (solid white, colored ring).
        pts.forEach(p => {
          ctx.fillStyle = '#ffffff'; ctx.strokeStyle = shape.color; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        });
      } else {
        pts.forEach(p => { ctx.fillStyle = shape.color; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); });
      }
    }

    // In-progress drawing
    if (inProgressVertices.length > 0) {
      const pts = inProgressVertices.map(v => toCanvas(v, t));
      pts.forEach(p => { ctx.fillStyle = '#6366f1'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); });
      if (pts.length > 1) {
        ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (cursorPos) {
        const cursor = toCanvas(cursorPos, t), last = pts[pts.length - 1];
        ctx.strokeStyle = 'rgba(99,102,241,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(cursor.x, cursor.y); ctx.stroke(); ctx.setLineDash([]);
        if (activeTool === 'area' && pts.length >= 3 && dist(cursor, pts[0]) < 12) {
          ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(cursor.x, cursor.y); ctx.lineTo(pts[0].x, pts[0].y); ctx.stroke();
          ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 7, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // Plants
    const plants = plan.plants ?? [];
    for (const plant of plants) {
      const pt = toCanvas(plant, t);
      if (plant.id === selectedPlantInstanceId) drawPlantSelected(ctx, plant.planSymbol, pt.x, pt.y);
      drawPlant(ctx, plant.planSymbol, pt.x, pt.y);
    }

    // Ghost plant at cursor when plant tool is active
    if (activeTool === 'plant' && cursorPos) {
      const selectedCat = (catalogPlants ?? []).find(c => c.id === selectedPlantId);
      if (selectedCat?.planSymbol) {
        const cursor = toCanvas(cursorPos, t);
        drawPlant(ctx, selectedCat.planSymbol, cursor.x, cursor.y, true);
      }
    }

    // Items
    const planItems = plan.items ?? [];
    for (const item of planItems) {
      const pt = toCanvas(item, t);
      if (item.id === selectedItemInstanceId) drawItemSelected(ctx, pt.x, pt.y);
      drawItem(ctx, item.itemSymbol, pt.x, pt.y);
    }

    // Ghost item at cursor when item tool is active
    if (activeTool === 'item' && cursorPos) {
      const selectedCat = (catalogItems ?? []).find(c => c.id === selectedItemCatalogId);
      if (selectedCat?.itemSymbol) {
        const cursor = toCanvas(cursorPos, t);
        drawItem(ctx, selectedCat.itemSymbol, cursor.x, cursor.y, true);
      }
    }

    // Linked-photo pins (drawn on top of everything).
    for (const pin of photoPins) {
      if (pin.x == null || pin.y == null) continue;
      const pt = toCanvas(pin, t);
      drawPhotoPin(ctx, pt.x, pt.y);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, groups, canvasSize, inProgressVertices, cursorPos, calPoints, selectedShapeId, selectedPlantInstanceId, selectedItemInstanceId, imageReady, activeTool, catalogPlants, catalogItems, showCalLine, showMeasurements, photoPins]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getCanvasPoint(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function getTransformNow() {
    const canvas = canvasRef.current;
    return getTransform(plan.imageWidth, plan.imageHeight, canvas?.width || canvasSize.width, canvas?.height || canvasSize.height);
  }

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  function handleMouseMove(e) {
    if (!plan.imageDataUrl) return;
    setCursorPos(fromCanvas(getCanvasPoint(e), getTransformNow()));
  }
  function handleMouseLeave() { setCursorPos(null); }

  function handleClick(e) {
    if (!plan.imageDataUrl) return;
    // A node drag just finished; ignore the click it synthesizes.
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }

    // Placing a photo pin: the next click sets its location, regardless of tool.
    if (placingPhoto) {
      const imgPt = fromCanvas(getCanvasPoint(e), getTransformNow());
      onPlacePhotoPin?.(imgPt);
      return;
    }

    const now = Date.now();
    const timeSinceLast = now - lastClickTimeRef.current;
    lastClickTimeRef.current = now;
    if (activeTool === 'linear' && timeSinceLast < 300) return;

    const cp = getCanvasPoint(e);
    const t = getTransformNow();
    const imgPt = fromCanvas(cp, t);

    if (activeTool === 'calibrate') {
      const newCal = [...calPoints, imgPt].slice(0, 2);
      setCalPoints(newCal);
      if (newCal.length === 2) onCalibrationPointsSet(newCal[0], newCal[1]);

    } else if (activeTool === 'area') {
      if (inProgressRef.current.length >= 3) {
        const firstCanvas = toCanvas(inProgressRef.current[0], t);
        if (dist(cp, firstCanvas) < 12) {
          const verts = [...inProgressRef.current];
          inProgressRef.current = []; setInProgressVertices([]);
          onShapeComplete('area', verts); return;
        }
      }
      const nv = [...inProgressRef.current, imgPt]; inProgressRef.current = nv; setInProgressVertices(nv);

    } else if (activeTool === 'linear') {
      const nv = [...inProgressRef.current, imgPt]; inProgressRef.current = nv; setInProgressVertices(nv);

    } else if (activeTool === 'plant') {
      const selectedCat = (catalogPlants ?? []).find(c => c.id === selectedPlantId);
      if (selectedCat?.planSymbol) {
        onAddPlant({ catalogId: selectedPlantId, planSymbol: selectedCat.planSymbol, x: imgPt.x, y: imgPt.y });
      }

    } else if (activeTool === 'item') {
      const selectedCat = (catalogItems ?? []).find(c => c.id === selectedItemCatalogId);
      if (selectedCat?.itemSymbol) {
        onAddItemPlacement({ catalogId: selectedItemCatalogId, itemSymbol: selectedCat.itemSymbol, x: imgPt.x, y: imgPt.y });
      }

    } else if (activeTool === 'select') {
      // Hit-test photo pins first (small, drawn on top) — click opens the photo.
      for (let i = photoPins.length - 1; i >= 0; i--) {
        const pin = photoPins[i];
        if (pin.x == null || pin.y == null) continue;
        if (dist(cp, toCanvas(pin, t)) < PIN_HIT_RADIUS) {
          onOpenPhotoPin?.(pin);
          return;
        }
      }
      // Hit-test shapes
      let foundShape = null;
      for (let i = plan.shapes.length - 1; i >= 0; i--) {
        const shape = plan.shapes[i];
        if (shape.type === 'area' && pointInPolygon(imgPt, shape.vertices)) { foundShape = shape.id; break; }
        if (shape.type === 'linear') {
          const cPts = shape.vertices.map(v => toCanvas(v, t));
          if (cPts.some((p, j) => j > 0 && distToSegment(cp, cPts[j - 1], p) < 8)) { foundShape = shape.id; break; }
        }
      }
      // Hit-test plants
      let foundPlant = null;
      if (!foundShape) {
        for (let i = (plan.plants ?? []).length - 1; i >= 0; i--) {
          const plant = plan.plants[i];
          const pt = toCanvas(plant, t);
          if (dist(cp, pt) < (PLANT_HIT_RADIUS[plant.planSymbol] ?? 16) + 4) { foundPlant = plant.id; break; }
        }
      }
      // Hit-test items
      let foundItem = null;
      if (!foundShape && !foundPlant) {
        for (let i = (plan.items ?? []).length - 1; i >= 0; i--) {
          const item = plan.items[i];
          const pt = toCanvas(item, t);
          if (dist(cp, pt) < ITEM_HIT_RADIUS + 4) { foundItem = item.id; break; }
        }
      }
      setSelectedShapeId(foundShape);
      setSelectedPlantInstanceId(foundPlant);
      setSelectedItemInstanceId(foundItem);
    }
  }

  function handleDoubleClick(e) {
    // In select mode, double-clicking a vertex deletes that node.
    if (activeTool === 'select') {
      if (!plan.imageDataUrl) return;
      const cp = getCanvasPoint(e);
      const t = getTransformNow();
      for (let i = plan.shapes.length - 1; i >= 0; i--) {
        const shape = plan.shapes[i];
        const min = shape.type === 'area' ? 3 : 2;
        if (shape.vertices.length <= min) continue;
        const pts = shape.vertices.map(v => toCanvas(v, t));
        for (let j = 0; j < pts.length; j++) {
          if (dist(cp, pts[j]) <= VERTEX_GRAB_RADIUS) {
            onUpdateShape(shape.id, { vertices: shape.vertices.filter((_, k) => k !== j) });
            suppressClickRef.current = true;
            return;
          }
        }
      }
      return;
    }
    if (activeTool !== 'linear') return;
    const verts = inProgressRef.current.slice(0, -1);
    inProgressRef.current = []; setInProgressVertices([]);
    if (verts.length >= 2) onShapeComplete('linear', verts);
  }

  // ── Node editing (select mode): drag a vertex, insert one on a midpoint, or
  //    drag the whole shape. Updates cascade to the take-off + loads instantly.
  function handlePointerDown(e) {
    if (activeTool !== 'select' || placingPhoto || !plan.imageDataUrl) return;
    const cp = getCanvasPoint(e);
    const t = getTransformNow();

    // 1) Grab an existing vertex of any shape (topmost first) and drag it.
    for (let i = plan.shapes.length - 1; i >= 0; i--) {
      const shape = plan.shapes[i];
      const pts = shape.vertices.map(v => toCanvas(v, t));
      for (let j = 0; j < pts.length; j++) {
        if (dist(cp, pts[j]) <= VERTEX_GRAB_RADIUS) {
          setSelectedShapeId(shape.id);
          dragRef.current = { kind: 'vertex', shapeId: shape.id, index: j, origVertices: shape.vertices };
          e.currentTarget.setPointerCapture?.(e.pointerId);
          return;
        }
      }
    }

    // 2) Insert a new vertex on a midpoint handle of the selected shape.
    if (selectedShapeId) {
      const shape = plan.shapes.find(s => s.id === selectedShapeId);
      if (shape) {
        const pts = shape.vertices.map(v => toCanvas(v, t));
        const segCount = shape.type === 'area' ? pts.length : pts.length - 1;
        for (let j = 0; j < segCount; j++) {
          const a = pts[j], b = pts[(j + 1) % pts.length];
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (dist(cp, mid) <= MIDPOINT_GRAB_RADIUS) {
            const insertAt = j + 1;
            const newVerts = [...shape.vertices.slice(0, insertAt), fromCanvas(mid, t), ...shape.vertices.slice(insertAt)];
            onUpdateShape(shape.id, { vertices: newVerts });
            dragRef.current = { kind: 'vertex', shapeId: shape.id, index: insertAt, origVertices: newVerts };
            e.currentTarget.setPointerCapture?.(e.pointerId);
            return;
          }
        }
      }
    }

    // 3) Grab the body of the selected shape to move the whole thing.
    if (selectedShapeId) {
      const shape = plan.shapes.find(s => s.id === selectedShapeId);
      if (shape) {
        const imgPt = fromCanvas(cp, t);
        const cPts = shape.vertices.map(v => toCanvas(v, t));
        const onBody = shape.type === 'area'
          ? pointInPolygon(imgPt, shape.vertices)
          : cPts.some((p, j) => j > 0 && distToSegment(cp, cPts[j - 1], p) < 8);
        if (onBody) {
          dragRef.current = { kind: 'shape', shapeId: shape.id, origVertices: shape.vertices, startImg: imgPt };
          e.currentTarget.setPointerCapture?.(e.pointerId);
          return;
        }
      }
    }
  }

  function handlePointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const imgPt = fromCanvas(getCanvasPoint(e), getTransformNow());
    if (drag.kind === 'vertex') {
      const newVerts = drag.origVertices.map((v, k) => (k === drag.index ? imgPt : v));
      onUpdateShape(drag.shapeId, { vertices: newVerts });
    } else if (drag.kind === 'shape') {
      const dx = imgPt.x - drag.startImg.x, dy = imgPt.y - drag.startImg.y;
      const newVerts = drag.origVertices.map(v => ({ x: v.x + dx, y: v.y + dy }));
      onUpdateShape(drag.shapeId, { vertices: newVerts });
    }
  }

  function handlePointerUp(e) {
    if (dragRef.current) {
      dragRef.current = null;
      suppressClickRef.current = true;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
  }

  // ── Keyboard handler ────────────────────────────────────────────────────────
  function handleKeyDown(e) {
    // Plant shortcuts when plant tool is active
    if (activeTool === 'plant') {
      const plantable = (catalogPlants ?? []).filter(c => c.planSymbol);
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < plantable.length) { onPlantIdChange(plantable[idx].id); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const cur = plantable.findIndex(c => c.id === selectedPlantId);
        const next = plantable[(cur + 1) % plantable.length];
        if (next) onPlantIdChange(next.id);
        return;
      }
    }

    // Item shortcuts when item tool is active
    if (activeTool === 'item') {
      const itemable = (catalogItems ?? []).filter(c => c.itemSymbol);
      const idx = parseInt(e.key) - 1;
      if (idx >= 0 && idx < itemable.length) { onItemCatalogIdChange(itemable[idx].id); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const cur = itemable.findIndex(c => c.id === selectedItemCatalogId);
        const next = itemable[(cur + 1) % itemable.length];
        if (next) onItemCatalogIdChange(next.id);
        return;
      }
    }

    if (e.key === 'Enter') {
      const verts = [...inProgressRef.current];
      if (activeTool === 'area' && verts.length >= 3) {
        inProgressRef.current = []; setInProgressVertices([]);
        onShapeComplete('area', verts);
      } else if (activeTool === 'linear' && verts.length >= 2) {
        inProgressRef.current = []; setInProgressVertices([]);
        onShapeComplete('linear', verts);
      }
    } else if (e.key === 'Escape') {
      inProgressRef.current = []; setInProgressVertices([]);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedShapeId) { e.preventDefault(); onRemoveShape(selectedShapeId); setSelectedShapeId(null); }
      else if (selectedPlantInstanceId) { e.preventDefault(); onRemovePlant(selectedPlantInstanceId); setSelectedPlantInstanceId(null); }
      else if (selectedItemInstanceId) { e.preventDefault(); onRemoveItemPlacement(selectedItemInstanceId); setSelectedItemInstanceId(null); }
    }
  }

  const cursorClass = (activeTool === 'select') ? 'cursor-default' : 'cursor-crosshair';

  return (
    <div
      ref={containerRef}
      className={`relative flex-1 overflow-hidden bg-gray-800 outline-none ${cursorClass}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="block w-full h-full"
        style={{ touchAction: activeTool === 'select' ? 'none' : undefined }}
      />
    </div>
  );
}
