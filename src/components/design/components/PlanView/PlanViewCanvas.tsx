import { useRef, useEffect, useState, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Circle, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';
import { usePlanSymbolStore } from '../../store/useCustomStampStore';
import { PlanStamp } from './PlanStamp';
import { ClusterOverlay } from './ClusterOverlay';
import { DuplicateStampMode } from '../Canvas/EditorCanvas';
import type { Point2D } from '../../types';

export function PlanViewCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const canvasWidth = useProjectStore((s) => s.canvasWidth);
  const canvasHeight = useProjectStore((s) => s.canvasHeight);
  const planView = useProjectStore((s) => s.planView);
  const planStamps = useProjectStore((s) => s.planStamps);
  const selectedStampId = useProjectStore((s) => s.selectedStampId);
  const selectStamp = useProjectStore((s) => s.selectStamp);
  const addPlanStamp = useProjectStore((s) => s.addPlanStamp);
  const removePlanStamp = useProjectStore((s) => s.removePlanStamp);
  const clusterMode = useProjectStore((s) => s.clusterMode);
  const setCanvasSize = useProjectStore((s) => s.setCanvasSize);
  const setPlanSelection = useProjectStore((s) => s.setPlanSelection);

  const [planImage, setPlanImage] = useState<HTMLImageElement | null>(null);
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [viewLocked, setViewLocked] = useState(false);

  const planPixelsPerFoot = useProjectStore((s) => s.planPixelsPerFoot);
  const setPlanPixelsPerFoot = useProjectStore((s) => s.setPlanPixelsPerFoot);

  // Polygon selection state
  const [polygonMode, setPolygonMode] = useState(false);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [isClosed, setIsClosed] = useState(false);

  // Scale tool state
  const [scaleMode, setScaleMode] = useState(false);
  const [scalePoint1, setScalePoint1] = useState<Point2D | null>(null);
  const [scalePoint2, setScalePoint2] = useState<Point2D | null>(null);
  const [scaleInput, setScaleInput] = useState('');

  // Track stamp being placed (press-drag-release)
  const placingStampId = useRef<string | null>(null);
  const placingPointerId = useRef<number | null>(null);
  // Object eraser
  const objEraserActive = useRef(false);
  const OBJ_ERASER_RADIUS = 30;
  // Cache the source stamp for stamp-gun mode so it doesn't change between taps
  const stampGunSource = useRef<{ assetId: string; manualScale: number; rotation: number; flipX: boolean; opacity: number } | null>(null);

  // Sort plan stamps by category render order:
  // ground-cover (bottom) → perennials → shrubs → grasses → columnar → ornamental → evergreens → shade-trees (top)
  const CATEGORY_ORDER: Record<string, number> = {
    'ground-cover': 0,
    'perennials': 1,
    'shrubs': 2,
    'grasses': 3,
    'columnar': 4,
    'ornamental-trees': 5,
    'evergreens': 6,
    'shade-trees': 7,
    'custom': 3,
    'textures': -1,
  };
  const planSymbolsStore = usePlanSymbolStore.getState();
  const sortedPlanStamps = [...planStamps].sort((a, b) => {
    const catA = planSymbolsStore.getSymbol(a.assetId)?.category ?? 'custom';
    const catB = planSymbolsStore.getSymbol(b.assetId)?.category ?? 'custom';
    return (CATEGORY_ORDER[catA] ?? 3) - (CATEGORY_ORDER[catB] ?? 3);
  });

  useEffect(() => {
    if (!planView.image) { setPlanImage(null); return; }
    const img = new window.Image();
    img.src = planView.image;
    img.onload = () => setPlanImage(img);
  }, [planView.image]);

  // Initial fit — only runs when image changes
  useEffect(() => {
    if (!containerRef.current || !planView.imageWidth || !planView.imageHeight) return;
    const { clientWidth, clientHeight } = containerRef.current;
    const s = Math.min(clientWidth / planView.imageWidth, clientHeight / planView.imageHeight, 1);
    setStageScale(s);
    setStagePos({
      x: (clientWidth - planView.imageWidth * s) / 2,
      y: (clientHeight - planView.imageHeight * s) / 2,
    });
  }, [planView.image]);

  // Canvas size tracking
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      setCanvasSize(clientWidth, clientHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [setCanvasSize]);

  // Pinch-to-zoom + wheel zoom
  // Use refs to avoid stale state in rapid pointer events
  const scaleRef = useRef(stageScale);
  const posRef = useRef(stagePos);
  useEffect(() => { scaleRef.current = stageScale; }, [stageScale]);
  useEffect(() => { posRef.current = stagePos; }, [stagePos]);

  useEffect(() => {
    if (viewLocked) return;
    const container = containerRef.current;
    if (!container) return;

    let lastDist = 0;
    let lastCx = 0;
    let lastCy = 0;
    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      active = true;
      const t1 = e.touches[0], t2 = e.touches[1];
      lastDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      lastCx = (t1.clientX + t2.clientX) / 2;
      lastCy = (t1.clientY + t2.clientY) / 2;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) { active = false; return; }
      e.preventDefault();
      e.stopPropagation();
      const t1 = e.touches[0], t2 = e.touches[1];
      const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const newCx = (t1.clientX + t2.clientX) / 2;
      const newCy = (t1.clientY + t2.clientY) / 2;

      if (!active || lastDist === 0) {
        lastDist = newDist;
        lastCx = newCx;
        lastCy = newCy;
        active = true;
        return;
      }

      const rect = container.getBoundingClientRect();
      const cx = newCx - rect.left;
      const cy = newCy - rect.top;

      const oldScale = scaleRef.current;
      const oldPos = posRef.current;

      // Compute zoom factor from distance change
      const factor = newDist / lastDist;
      const newScale = Math.max(0.1, Math.min(8, oldScale * factor));

      // Pan delta from center movement
      const panDx = newCx - lastCx;
      const panDy = newCy - lastCy;

      // Keep the point under the fingers stable during zoom
      const imgX = (cx - oldPos.x) / oldScale;
      const imgY = (cy - oldPos.y) / oldScale;
      const newPos = {
        x: cx - imgX * newScale + panDx,
        y: cy - imgY * newScale + panDy,
      };

      scaleRef.current = newScale;
      posRef.current = newPos;
      setStageScale(newScale);
      setStagePos(newPos);

      lastDist = newDist;
      lastCx = newCx;
      lastCy = newCy;
    };

    const onTouchEnd = () => {
      active = false;
      lastDist = 0;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const oldScale = scaleRef.current;
      const oldPos = posRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.1, Math.min(8, oldScale * factor));

      const imgX = (cx - oldPos.x) / oldScale;
      const imgY = (cy - oldPos.y) / oldScale;
      const newPos = {
        x: cx - imgX * newScale,
        y: cy - imgY * newScale,
      };

      scaleRef.current = newScale;
      posRef.current = newPos;
      setStageScale(newScale);
      setStagePos(newPos);
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
      container.removeEventListener('wheel', onWheel);
    };
  }, [viewLocked]);

  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (clientX - rect.left - stagePos.x) / stageScale,
      y: (clientY - rect.top - stagePos.y) / stageScale,
    };
  }, [stagePos, stageScale]);

  // Press-drag-release placement for plan stamps
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isOverCanvas = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return e.clientX >= rect.left && e.clientX <= rect.right &&
             e.clientY >= rect.top && e.clientY <= rect.bottom;
    };

    const eraseAtPosition = (clientX: number, clientY: number) => {
      const pos = clientToCanvas(clientX, clientY);
      if (!pos) return;
      const state = useProjectStore.getState();
      const toRemove = state.planStamps.filter((s) => {
        const dx = s.x - pos.x;
        const dy = s.y - pos.y;
        return Math.sqrt(dx * dx + dy * dy) < OBJ_ERASER_RADIUS / stageScale;
      });
      for (const s of toRemove) {
        removePlanStamp(s.id);
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!isOverCanvas(e)) return;
      // Skip during multi-touch (pinch zoom)
      if (e.pointerType === 'touch' && (e as any).isPrimary === false) return;
      const state = useProjectStore.getState();

      // Object eraser mode
      if (state.toolMode === 'objEraser') {
        e.preventDefault();
        e.stopPropagation();
        objEraserActive.current = true;
        eraseAtPosition(e.clientX, e.clientY);
        return;
      }

      if (state.moveOnly) return;

      // Scale mode — tap two points
      if (scaleMode) {
        const pos = clientToCanvas(e.clientX, e.clientY);
        if (!pos) return;
        e.preventDefault();
        e.stopPropagation();
        if (!scalePoint1) {
          setScalePoint1(pos);
        } else if (!scalePoint2) {
          setScalePoint2(pos);
        }
        return;
      }

      // Stamp-gun mode — duplicate selected plan stamp at tap position
      if (DuplicateStampMode.active) {
        // Cache source on first use
        if (!stampGunSource.current) {
          const src = state.planStamps.find((s) => s.id === state.selectedStampId);
          if (!src) return;
          stampGunSource.current = {
            assetId: src.assetId,
            manualScale: src.manualScale,
            rotation: src.rotation,
            flipX: src.flipX,
            opacity: src.opacity,
          };
        }

        const pos = clientToCanvas(e.clientX, e.clientY);
        if (!pos) return;

        e.preventDefault();
        e.stopPropagation();

        const src = stampGunSource.current;
        addPlanStamp(src.assetId, pos.x, pos.y);
        const newId = useProjectStore.getState().selectedStampId;
        if (newId) {
          useProjectStore.getState().updatePlanStamp(newId, {
            manualScale: src.manualScale,
            rotation: src.rotation,
            flipX: src.flipX,
            opacity: src.opacity,
          });
          placingStampId.current = newId;
          placingPointerId.current = e.pointerId;
        }
        return;
      }

      // Clear stamp-gun cache when not in stamp-gun mode
      stampGunSource.current = null;

      // Pending stamp placement
      if (!state.pendingStampAssetId) return;

      const pos = clientToCanvas(e.clientX, e.clientY);
      if (!pos) return;

      e.preventDefault();
      e.stopPropagation();

      addPlanStamp(state.pendingStampAssetId, pos.x, pos.y);
      const newId = useProjectStore.getState().selectedStampId;
      if (newId) {
        placingStampId.current = newId;
        placingPointerId.current = e.pointerId;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      // Object eraser continuous swipe
      if (objEraserActive.current) {
        e.preventDefault();
        eraseAtPosition(e.clientX, e.clientY);
        return;
      }
      if (!placingStampId.current || e.pointerId !== placingPointerId.current) return;
      e.preventDefault();
      const pos = clientToCanvas(e.clientX, e.clientY);
      if (pos) {
        useProjectStore.getState().updatePlanStamp(placingStampId.current, { x: pos.x, y: pos.y });
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (objEraserActive.current) {
        objEraserActive.current = false;
        return;
      }
      if (!placingStampId.current || e.pointerId !== placingPointerId.current) return;
      const pos = clientToCanvas(e.clientX, e.clientY);
      if (pos) {
        useProjectStore.getState().updatePlanStamp(placingStampId.current, { x: pos.x, y: pos.y });
      }
      placingStampId.current = null;
      placingPointerId.current = null;
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerup', handlePointerUp, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
    };
  }, [clientToCanvas, addPlanStamp, removePlanStamp, scaleMode, scalePoint1, scalePoint2, stageScale]);

  // Konva click — polygon selection or deselect
  const getPlanPos = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return { x: (pos.x - stagePos.x) / stageScale, y: (pos.y - stagePos.y) / stageScale };
  }, [stagePos, stageScale]);

  const handleTap = useCallback(() => {
    const state = useProjectStore.getState();
    if (state.pendingStampAssetId) return;

    // Scale mode — tap two points
    if (scaleMode) {
      const pos = getPlanPos();
      if (!pos) return;
      if (!scalePoint1) {
        setScalePoint1(pos);
      } else if (!scalePoint2) {
        setScalePoint2(pos);
      }
      return;
    }

    // Only do polygon selection when polygon mode is active
    if (polygonMode && !isClosed && planView.image) {
      const pos = getPlanPos();
      if (!pos) return;
      if (points.length >= 3) {
        const first = points[0];
        const dist = Math.sqrt((pos.x - first.x) ** 2 + (pos.y - first.y) ** 2);
        if (dist < 25 / stageScale) { closeAndCrop(); return; }
      }
      setPoints((prev) => [...prev, pos]);
      return;
    }
  }, [polygonMode, isClosed, getPlanPos, points, stageScale, planView.image]);

  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (useProjectStore.getState().pendingStampAssetId) return;
    if (polygonMode) return;
    if (e.target === e.target.getStage()) {
      selectStamp(null);
    }
  }, [selectStamp, polygonMode]);

  const closeAndCrop = useCallback(() => {
    if (points.length < 3 || !planImage) return;
    setIsClosed(true);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    minX = Math.max(0, Math.floor(minX)); minY = Math.max(0, Math.floor(minY));
    maxX = Math.min(planView.imageWidth, Math.ceil(maxX)); maxY = Math.min(planView.imageHeight, Math.ceil(maxY));
    const w = maxX - minX, h = maxY - minY;
    if (w < 10 || h < 10) return;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = w; cropCanvas.height = h;
    const ctx = cropCanvas.getContext('2d')!;
    ctx.beginPath(); ctx.moveTo(points[0].x - minX, points[0].y - minY);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x - minX, points[i].y - minY);
    ctx.closePath(); ctx.clip();
    ctx.drawImage(planImage, minX, minY, w, h, 0, 0, w, h);
    setPlanSelection(cropCanvas.toDataURL('image/png'), w, h);
    setTimeout(() => { setPoints([]); setIsClosed(false); }, 300);
  }, [points, planImage, planView.imageWidth, planView.imageHeight, setPlanSelection]);

  const flatPoints = points.flatMap((p) => [p.x, p.y]);
  const hasPending = !!useProjectStore((s) => s.pendingStampAssetId);

  return (
    <div ref={containerRef} className="absolute inset-0 bg-gray-50 overflow-hidden" style={{ touchAction: 'none' }}>
      {/* Top bar: instructions + polygon toggle */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex gap-2 items-center">
        {hasPending && (
          <div className="bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-medium pointer-events-none">
            Press and drag to place symbol
          </div>
        )}
        {!hasPending && !polygonMode && (
          <div className="bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-medium pointer-events-none">
            Plan View
          </div>
        )}
        {polygonMode && (
          <div className="bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-medium pointer-events-none">
            {points.length === 0 ? 'Tap to draw selection polygon'
              : points.length < 3 ? `Tap to add points (${points.length}/3 min)`
              : 'Tap first point to close, or keep adding'}
          </div>
        )}
        {scaleMode && (
          <div className="bg-purple-500 text-white px-3 py-1 rounded-full text-xs font-medium pointer-events-none">
            {!scalePoint1 ? 'Tap the first point of a known dimension'
              : !scalePoint2 ? 'Tap the second point'
              : 'Enter the distance below'}
          </div>
        )}
        <button
          onClick={() => { setPolygonMode(!polygonMode); setScaleMode(false); setPoints([]); setIsClosed(false); }}
          className={`px-3 py-1 rounded-full text-xs font-medium shadow transition-colors ${
            polygonMode ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 border border-gray-300'
          }`}
        >
          {polygonMode ? 'Exit Polygon' : 'Polygon'}
        </button>
        <button
          onClick={() => { setScaleMode(!scaleMode); setPolygonMode(false); setScalePoint1(null); setScalePoint2(null); setScaleInput(''); }}
          className={`px-3 py-1 rounded-full text-xs font-medium shadow transition-colors ${
            scaleMode ? 'bg-purple-500 text-white' : 'bg-white text-gray-600 border border-gray-300'
          }`}
        >
          {scaleMode ? 'Exit Scale' : planPixelsPerFoot ? `Scale: ${Math.round(planPixelsPerFoot)}px/ft` : 'Set Scale'}
        </button>
      </div>

      {/* Zoom controls (top-right) */}
      {planView.image && (
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <button
            onClick={() => {
              if (!containerRef.current || !planView.imageWidth) return;
              const { clientWidth, clientHeight } = containerRef.current;
              const s = Math.min(clientWidth / planView.imageWidth, clientHeight / planView.imageHeight, 1);
              setStageScale(s);
              setStagePos({
                x: (clientWidth - planView.imageWidth * s) / 2,
                y: (clientHeight - planView.imageHeight * s) / 2,
              });
            }}
            className="w-9 h-9 rounded-full bg-white border border-gray-300 shadow flex items-center justify-center text-gray-600 text-[10px] font-semibold"
            title="Fit to view"
          >
            FIT
          </button>
          <button
            onClick={() => setViewLocked(!viewLocked)}
            className={`w-9 h-9 rounded-full border shadow flex items-center justify-center ${
              viewLocked ? 'bg-red-500 text-white border-red-600' : 'bg-white text-gray-600 border-gray-300'
            }`}
            title={viewLocked ? 'Unlock view' : 'Lock view'}
          >
            {viewLocked ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            )}
          </button>
        </div>
      )}

      {polygonMode && points.length > 0 && !isClosed && (
        <div className="absolute top-10 left-1/2 -translate-x-1/2 z-10 flex gap-2">
          <button onClick={() => { setPoints([]); setIsClosed(false); }} className="px-3 py-1 bg-red-500 text-white rounded-full text-xs font-medium shadow">Clear</button>
          <button onClick={() => setPoints((p) => p.slice(0, -1))} className="px-3 py-1 bg-gray-500 text-white rounded-full text-xs font-medium shadow">Undo Point</button>
          {points.length >= 3 && <button onClick={closeAndCrop} className="px-3 py-1 bg-blue-500 text-white rounded-full text-xs font-medium shadow">Done</button>}
        </div>
      )}

      {/* Scale distance input */}
      {scaleMode && scalePoint1 && scalePoint2 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-white rounded-xl shadow-xl border border-gray-200 p-3 w-64 select-none" style={{ WebkitTouchCallout: 'none' }}>
          <p className="text-xs text-gray-600 mb-2">Enter the real-world distance between the two points:</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={scaleInput}
              onChange={(e) => setScaleInput(e.target.value)}
              placeholder="e.g. 20"
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              autoFocus
              style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
            />
            <span className="text-sm text-gray-500 font-medium">ft</span>
            <button
              onClick={() => {
                const ft = parseFloat(scaleInput);
                if (!ft || ft <= 0 || !scalePoint1 || !scalePoint2) return;
                const dx = scalePoint2.x - scalePoint1.x;
                const dy = scalePoint2.y - scalePoint1.y;
                const pixelDist = Math.sqrt(dx * dx + dy * dy);
                if (pixelDist <= 0) return;
                setPlanPixelsPerFoot(pixelDist / ft);
                setScaleMode(false);
                setScalePoint1(null);
                setScalePoint2(null);
                setScaleInput('');
              }}
              disabled={!scaleInput || parseFloat(scaleInput) <= 0}
              className="px-3 py-1.5 bg-purple-500 text-white rounded-lg text-sm font-medium disabled:opacity-30"
            >
              Set
            </button>
          </div>
        </div>
      )}

      {!planView.image ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <p className="text-lg font-medium">No plan image yet</p>
            <p className="text-sm mt-1">Upload a site plan using the grid icon in the toolbar</p>
          </div>
        </div>
      ) : (
        <Stage
          ref={stageRef}
          width={canvasWidth || 1}
          height={canvasHeight || 1}
          scaleX={stageScale}
          scaleY={stageScale}
          x={stagePos.x}
          y={stagePos.y}
          draggable={false}
          onClick={(e) => { handleTap(); handleStageClick(e); }}
          onTap={(e) => { handleTap(); handleStageClick(e); }}
        >
          {/* Plan image */}
          <Layer listening={false}>
            {planImage && (
              <KonvaImage image={planImage} x={0} y={0} width={planView.imageWidth} height={planView.imageHeight} />
            )}
          </Layer>

          {/* Placed plan symbols — sorted by category layer order */}
          <Layer>
            {sortedPlanStamps.map((stamp) => (
              <PlanStamp key={stamp.id} stamp={stamp} isSelected={stamp.id === selectedStampId} />
            ))}
          </Layer>

          {/* Cluster outlines (above stamps, non-interactive) */}
          {clusterMode && (
            <Layer listening={false}>
              <ClusterOverlay stamps={sortedPlanStamps} />
            </Layer>
          )}

          {/* Scale measurement points */}
          <Layer listening={false}>
            {scaleMode && scalePoint1 && (
              <Circle x={scalePoint1.x} y={scalePoint1.y} radius={8 / stageScale} fill="#a855f7" stroke="#fff" strokeWidth={2 / stageScale} />
            )}
            {scaleMode && scalePoint2 && (
              <Circle x={scalePoint2.x} y={scalePoint2.y} radius={8 / stageScale} fill="#a855f7" stroke="#fff" strokeWidth={2 / stageScale} />
            )}
            {scaleMode && scalePoint1 && scalePoint2 && (
              <Line points={[scalePoint1.x, scalePoint1.y, scalePoint2.x, scalePoint2.y]} stroke="#a855f7" strokeWidth={2 / stageScale} dash={[6 / stageScale, 4 / stageScale]} />
            )}
          </Layer>

          {/* Selection polygon overlay */}
          <Layer listening={false}>
            {points.length > 0 && (
              <Rect x={0} y={0} width={planView.imageWidth} height={planView.imageHeight} fill="rgba(0,0,0,0.25)" />
            )}
            {points.length >= 2 && (
              <Line points={flatPoints} stroke="#3b82f6" strokeWidth={3 / stageScale} closed={isClosed} fill={isClosed ? 'rgba(59,130,246,0.15)' : undefined} />
            )}
            {points.map((p, i) => (
              <Circle key={i} x={p.x} y={p.y} radius={i === 0 && points.length >= 3 ? 12 / stageScale : 6 / stageScale} fill={i === 0 ? '#22c55e' : '#3b82f6'} stroke="#fff" strokeWidth={2 / stageScale} />
            ))}
            {points.length >= 3 && !isClosed && (
              <Text x={points[0].x + 14 / stageScale} y={points[0].y - 8 / stageScale} text="Tap to close" fontSize={12 / stageScale} fill="#22c55e" fontStyle="bold" />
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
}
