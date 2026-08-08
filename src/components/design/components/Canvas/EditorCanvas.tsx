import { useRef, useEffect, useCallback } from 'react';
import { Stage, Layer } from 'react-konva';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';
import { BackgroundImage } from './BackgroundImage';
import { PerspectiveGuides } from './PerspectiveGuides';
import { PlantStamp } from './PlantStamp';
import { CalibrationOverlay } from './CalibrationOverlay';
import { PlanOverlay } from './PlanOverlay';

/** Global flag for duplicate stamping mode (held by SizeSlider's duplicate button) */
export const DuplicateStampMode = { active: false };

interface EditorCanvasProps {
  stageRef: React.RefObject<Konva.Stage | null>;
}

export function EditorCanvas({ stageRef }: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const canvasWidth = useProjectStore((s) => s.canvasWidth);
  const canvasHeight = useProjectStore((s) => s.canvasHeight);
  const backgroundImage = useProjectStore((s) => s.backgroundImage);
  const backgroundWidth = useProjectStore((s) => s.backgroundWidth);
  const backgroundHeight = useProjectStore((s) => s.backgroundHeight);
  const stamps = useProjectStore((s) => s.stamps);
  const selectedStampId = useProjectStore((s) => s.selectedStampId);
  const selectStamp = useProjectStore((s) => s.selectStamp);
  const stageScale = useProjectStore((s) => s.stageScale);
  const stageX = useProjectStore((s) => s.stageX);
  const stageY = useProjectStore((s) => s.stageY);
  const setStageTransform = useProjectStore((s) => s.setStageTransform);
  const setCanvasSize = useProjectStore((s) => s.setCanvasSize);
  const addStamp = useProjectStore((s) => s.addStamp);
  const toolMode = useProjectStore((s) => s.toolMode);
  const pendingStampAssetId = useProjectStore((s) => s.pendingStampAssetId);
  const hasOverlay = !!useProjectStore((s) => s.planView.selectionImage);
  const eraserActive = useRef(false);

  // Track the stamp being placed (press-drag-release flow)
  const placingStampId = useRef<string | null>(null);
  const placingPointerId = useRef<number | null>(null);

  // Fit canvas to container
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const { clientWidth, clientHeight } = containerRef.current;
      setCanvasSize(clientWidth, clientHeight);

      if (backgroundWidth && backgroundHeight) {
        const scaleX = clientWidth / backgroundWidth;
        const scaleY = clientHeight / backgroundHeight;
        let scale = Math.min(scaleX, scaleY, 1);
        if (hasOverlay) scale *= 0.66;
        const x = (clientWidth - backgroundWidth * scale) / 2;
        const y = (clientHeight - backgroundHeight * scale) / 2;
        setStageTransform(scale, x, y);
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [backgroundWidth, backgroundHeight, hasOverlay, setCanvasSize, setStageTransform]);

  // Convert client coords to canvas coords
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const s = useProjectStore.getState();
    return {
      x: (clientX - rect.left - s.stageX) / s.stageScale,
      y: (clientY - rect.top - s.stageY) / s.stageScale,
    };
  }, []);

  // ---- Press-drag-release placement (works with finger AND Apple Pencil) ----
  // Uses document-level capture phase listeners so they fire BEFORE Konva
  // can consume the events. This is critical for Apple Pencil which fires
  // pointer events that Konva's canvas may intercept.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isOverCanvas = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return e.clientX >= rect.left && e.clientX <= rect.right &&
             e.clientY >= rect.top && e.clientY <= rect.bottom;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (!isOverCanvas(e)) return;

      const state = useProjectStore.getState();

      // Move-only mode — skip all placement
      if (state.moveOnly) return;

      // Stamp-gun mode
      if (DuplicateStampMode.active) {
        const pos = clientToCanvas(e.clientX, e.clientY);
        if (!pos) return;
        const srcStamp = state.stamps.find((s) => s.id === state.selectedStampId);
        if (!srcStamp) return;

        e.preventDefault();
        e.stopPropagation();

        addStamp(srcStamp.assetId, pos.x, pos.y);
        const newId = useProjectStore.getState().selectedStampId;
        if (newId) {
          useProjectStore.getState().updateStamp(newId, {
            manualScale: srcStamp.manualScale,
            rotation: srcStamp.rotation,
            flipX: srcStamp.flipX,
            opacity: srcStamp.opacity,
          });
          placingStampId.current = newId;
          placingPointerId.current = e.pointerId;
        }
        return;
      }

      // Pending stamp placement
      if (state.pendingStampAssetId && state.backgroundImage) {
        const pos = clientToCanvas(e.clientX, e.clientY);
        if (!pos) return;

        e.preventDefault();
        e.stopPropagation();

        addStamp(state.pendingStampAssetId, pos.x, pos.y);
        const newId = useProjectStore.getState().selectedStampId;
        if (newId) {
          placingStampId.current = newId;
          placingPointerId.current = e.pointerId;
        }
        return;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!placingStampId.current || e.pointerId !== placingPointerId.current) return;
      e.preventDefault();

      const pos = clientToCanvas(e.clientX, e.clientY);
      if (!pos) return;

      useProjectStore.getState().updateStamp(placingStampId.current, {
        x: pos.x,
        y: pos.y,
      });
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!placingStampId.current || e.pointerId !== placingPointerId.current) return;

      const pos = clientToCanvas(e.clientX, e.clientY);
      if (pos) {
        useProjectStore.getState().updateStamp(placingStampId.current, {
          x: pos.x,
          y: pos.y,
        });
      }

      placingStampId.current = null;
      placingPointerId.current = null;
    };

    const handlePointerCancel = () => {
      placingStampId.current = null;
      placingPointerId.current = null;
    };

    // CAPTURE PHASE — fires before Konva can consume the events
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', handlePointerCancel, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [clientToCanvas, addStamp]);

  // Handle Konva click/tap — only for selecting/deselecting stamps (not placement)
  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Don't deselect if we're in a placement mode
      if (DuplicateStampMode.active) return;
      if (useProjectStore.getState().pendingStampAssetId) return;

      if (e.target === e.target.getStage()) {
        selectStamp(null);
      }
    },
    [selectStamp]
  );

  // Scroll-wheel zoom (desktop only)
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const scaleBy = 1.08;
      const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
      const clampedScale = Math.max(0.1, Math.min(5, newScale));

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      const newX = pointer.x - mousePointTo.x * clampedScale;
      const newY = pointer.y - mousePointTo.y * clampedScale;

      setStageTransform(clampedScale, newX, newY);
    },
    [stageRef, setStageTransform]
  );

  // Handle drop from stamp library (desktop)
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const assetId = e.dataTransfer.getData('stamp-asset-id');
      if (!assetId) return;
      const pos = clientToCanvas(e.clientX, e.clientY);
      if (pos) addStamp(assetId, pos.x, pos.y);
    },
    [clientToCanvas, addStamp]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // Eraser handlers (Konva events)
  const getCanvasPos = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    const s = useProjectStore.getState();
    return {
      x: (pos.x - s.stageX) / s.stageScale,
      y: (pos.y - s.stageY) / s.stageScale,
    };
  }, [stageRef]);

  const handleMouseDown = useCallback((_e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (useProjectStore.getState().toolMode !== 'eraser') return;
    eraserActive.current = true;
    PlanOverlay.onEraseStart();
    const pos = getCanvasPos();
    if (pos) PlanOverlay.onEraseMove(pos.x, pos.y);
  }, [getCanvasPos]);

  const handleMouseMove = useCallback((_e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!eraserActive.current) return;
    const pos = getCanvasPos();
    if (pos) PlanOverlay.onEraseMove(pos.x, pos.y);
  }, [getCanvasPos]);

  const handleMouseUp = useCallback(() => {
    if (!eraserActive.current) return;
    eraserActive.current = false;
    PlanOverlay.onEraseEnd();
  }, []);

  // Sort stamps by Y position for depth ordering
  const sortedStamps = [...stamps].sort((a, b) => a.y - b.y);

  const cursorClass = toolMode === 'eraser' ? 'cursor-crosshair' : pendingStampAssetId ? 'cursor-crosshair' : '';

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 bg-gray-100 overflow-hidden ${cursorClass}`}
      style={{ touchAction: 'none' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {!backgroundImage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center text-gray-400">
            <p className="text-lg font-medium">Upload a photo to get started</p>
            <p className="text-sm mt-1">Use the Upload button in the toolbar</p>
          </div>
        </div>
      )}

      {toolMode === 'eraser' && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-rose-500 text-white px-3 py-1 rounded-full text-xs font-medium z-10 pointer-events-none">
          Draw to erase overlay
        </div>
      )}

      {pendingStampAssetId && backgroundImage && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-medium z-10 pointer-events-none">
          Press and drag to place plant
        </div>
      )}

      <Stage
        ref={stageRef}
        width={canvasWidth || 1}
        height={canvasHeight || 1}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stageX}
        y={stageY}
        draggable={false}
        onClick={handleStageClick}
        onTap={handleStageClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchMove={handleMouseMove}
        onTouchEnd={handleMouseUp}
      >
        {/* Background photo layer */}
        <Layer listening={false}>
          <BackgroundImage />
        </Layer>

        {/* Plan overlay layer (warped plan image) */}
        <Layer>
          <PlanOverlay />
        </Layer>

        {/* Stamps layer */}
        <Layer>
          {sortedStamps.map((stamp) => (
            <PlantStamp
              key={stamp.id}
              stamp={stamp}
              isSelected={stamp.id === selectedStampId}
            />
          ))}
        </Layer>

        {/* Perspective guides + calibration layer (on top) */}
        <Layer>
          {backgroundImage && <PerspectiveGuides />}
          {backgroundImage && <CalibrationOverlay />}
        </Layer>
      </Stage>
    </div>
  );
}
