import { useRef, useCallback, useEffect, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import { useProjectStore } from '../../store/useProjectStore';
import { LightingOverlay } from './LightingOverlay';
import { LightMarker } from './LightMarker';
import { LightPropertiesPanel } from './LightPropertiesPanel';

export function LightingCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const backgroundImage = useProjectStore((s) => s.backgroundImage);
  const bgWidth = useProjectStore((s) => s.backgroundWidth);
  const bgHeight = useProjectStore((s) => s.backgroundHeight);
  const canvasWidth = useProjectStore((s) => s.canvasWidth);
  const canvasHeight = useProjectStore((s) => s.canvasHeight);
  const setCanvasSize = useProjectStore((s) => s.setCanvasSize);
  const stageScale = useProjectStore((s) => s.stageScale);
  const stageX = useProjectStore((s) => s.stageX);
  const stageY = useProjectStore((s) => s.stageY);
  const setStageTransform = useProjectStore((s) => s.setStageTransform);

  const lightingConfig = useProjectStore((s) => s.lightingConfig);
  const selectedLightId = useProjectStore((s) => s.selectedLightId);
  const selectLight = useProjectStore((s) => s.selectLight);
  const updateLight = useProjectStore((s) => s.updateLight);
  const addLight = useProjectStore((s) => s.addLight);
  const toolMode = useProjectStore((s) => s.toolMode);
  const pendingLightType = useProjectStore((s) => s.pendingLightType);
  const setLightingPenMask = useProjectStore((s) => s.setLightingPenMask);

  // Pen drawing state
  const penMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [penMaskVersion, setPenMaskVersion] = useState(0);
  const penActive = useRef(false);
  const penPointerId = useRef<number | null>(null);
  const lastPenPos = useRef<{ x: number; y: number } | null>(null);

  // Resize to fill container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setCanvasSize(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [setCanvasSize]);

  // Fit image to canvas on load
  useEffect(() => {
    if (!bgWidth || !bgHeight || !canvasWidth || !canvasHeight) return;
    const scale = Math.min(canvasWidth / bgWidth, canvasHeight / bgHeight, 1);
    const x = (canvasWidth - bgWidth * scale) / 2;
    const y = (canvasHeight - bgHeight * scale) / 2;
    setStageTransform(scale, x, y);
  }, [bgWidth, bgHeight, canvasWidth, canvasHeight, setStageTransform]);

  // Zoom via scroll wheel
  const handleWheel = useCallback((e: any) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const oldScale = stageScale;
    const factor = e.evt.deltaY < 0 ? 1.08 : 1 / 1.08;
    const newScale = Math.max(0.1, Math.min(5, oldScale * factor));
    const mouseX = (pointer.x - stageX) / oldScale;
    const mouseY = (pointer.y - stageY) / oldScale;
    setStageTransform(newScale, pointer.x - mouseX * newScale, pointer.y - mouseY * newScale);
  }, [stageScale, stageX, stageY, setStageTransform]);

  // Convert client (screen) coordinates to image-space pixels
  const clientToImageCoords = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;
    const imgX = (canvasX - stageX) / stageScale;
    const imgY = (canvasY - stageY) / stageScale;
    return { x: imgX, y: imgY };
  }, [stageX, stageY, stageScale]);

  // Draw a single airbrush dab — low opacity, wide soft falloff matching light gradients
  const drawPenStroke = useCallback((imgX: number, imgY: number) => {
    const mc = penMaskCanvasRef.current;
    if (!mc) return;
    const ctx = mc.getContext('2d')!;
    const r = lightingConfig.penBrushSize;

    // Match the light gradient curve: center → 50% radius → edge
    // Use low per-dab opacity so overlapping dabs build up gradually (airbrush effect)
    const gradient = ctx.createRadialGradient(imgX, imgY, 0, imgX, imgY, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.08)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.03)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(imgX, imgY, r, 0, Math.PI * 2);
    ctx.fill();
  }, [lightingConfig.penBrushSize]);

  // Interpolate between two points — tight spacing for smooth buildup
  const drawPenLine = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Tight spacing relative to brush size — dabs overlap heavily for smooth airbrush buildup
    const spacing = Math.max(1, lightingConfig.penBrushSize * 0.15);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      drawPenStroke(from.x + dx * t, from.y + dy * t);
    }
    setPenMaskVersion((v) => v + 1);
  }, [drawPenStroke, lightingConfig.penBrushSize]);

  // Pointer event handlers for light pen drawing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      if (useProjectStore.getState().toolMode !== 'lightPen') return;
      e.preventDefault();
      penActive.current = true;
      penPointerId.current = e.pointerId;
      const pos = clientToImageCoords(e.clientX, e.clientY);
      if (!pos) return;
      lastPenPos.current = pos;
      drawPenStroke(pos.x, pos.y);
      setPenMaskVersion((v) => v + 1);
    };

    const onMove = (e: PointerEvent) => {
      if (!penActive.current || e.pointerId !== penPointerId.current) return;
      e.preventDefault();
      const pos = clientToImageCoords(e.clientX, e.clientY);
      if (!pos) return;
      if (lastPenPos.current) {
        drawPenLine(lastPenPos.current, pos);
      } else {
        drawPenStroke(pos.x, pos.y);
        setPenMaskVersion((v) => v + 1);
      }
      lastPenPos.current = pos;
    };

    const onUp = (e: PointerEvent) => {
      if (!penActive.current || e.pointerId !== penPointerId.current) return;
      penActive.current = false;
      penPointerId.current = null;
      lastPenPos.current = null;
      // Persist the mask to store
      const mc = penMaskCanvasRef.current;
      if (mc && mc.width > 0) {
        setLightingPenMask(mc.toDataURL());
      }
    };

    el.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [clientToImageCoords, drawPenStroke, drawPenLine, setLightingPenMask]);

  // Click to place light or deselect (only when NOT in lightPen mode)
  const handleStageClick = useCallback((e: any) => {
    if (toolMode === 'lightPen') return; // pen handles its own events
    const stage = e.target.getStage();
    if (e.target !== stage && e.target.getLayer()?.listening()) return;

    if (toolMode === 'placeLight' && pendingLightType && stage) {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const imgX = (pointer.x - stageX) / stageScale;
      const imgY = (pointer.y - stageY) / stageScale;
      const normX = imgX / bgWidth;
      const normY = imgY / bgHeight;
      if (normX >= 0 && normX <= 1 && normY >= 0 && normY <= 1) {
        addLight(normX, normY, pendingLightType);
      }
    } else {
      selectLight(null);
    }
  }, [toolMode, pendingLightType, stageX, stageY, stageScale, bgWidth, bgHeight, addLight, selectLight]);

  const isPlacing = toolMode === 'placeLight' && !!pendingLightType;
  const isPenMode = toolMode === 'lightPen';

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{
        cursor: isPenMode ? 'crosshair' : isPlacing ? 'crosshair' : 'default',
        touchAction: isPenMode ? 'none' : 'auto',
      }}
    >
      <Stage
        width={canvasWidth}
        height={canvasHeight}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stageX}
        y={stageY}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onTap={handleStageClick}
      >
        {/* Layer 0: Composited night scene */}
        <Layer listening={false}>
          {backgroundImage && bgWidth > 0 && bgHeight > 0 && (
            <LightingOverlay
              backgroundImage={backgroundImage}
              bgWidth={bgWidth}
              bgHeight={bgHeight}
              lights={lightingConfig.lights}
              overlayColor={lightingConfig.overlayColor}
              overlayOpacity={lightingConfig.overlayOpacity}
              penMask={lightingConfig.penMask}
              penMaskCanvasRef={penMaskCanvasRef}
              penMaskVersion={penMaskVersion}
            />
          )}
        </Layer>

        {/* Layer 1: Interactive light markers */}
        <Layer>
          {lightingConfig.lights.map((light) => (
            <LightMarker
              key={light.id}
              light={light}
              bgWidth={bgWidth}
              bgHeight={bgHeight}
              isSelected={selectedLightId === light.id}
              onSelect={() => selectLight(light.id)}
              onMove={(x, y) => updateLight(light.id, { x, y })}
            />
          ))}
        </Layer>
      </Stage>

      {/* Placement mode indicator */}
      {isPlacing && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-xs font-semibold px-4 py-1.5 rounded-full shadow-lg pointer-events-none">
          Tap to place {pendingLightType}
        </div>
      )}

      {/* Pen mode indicator */}
      {isPenMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-violet-500 text-white text-xs font-semibold px-4 py-1.5 rounded-full shadow-lg pointer-events-none">
          Draw to reveal light
        </div>
      )}

      {/* No image prompt */}
      {!backgroundImage && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-gray-400 text-lg">Upload a photo first, then switch to Lighting view</p>
        </div>
      )}

      {/* Overlay darkness + brush size controls */}
      {backgroundImage && (
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-2 flex flex-col gap-2 z-10">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/70 font-medium w-14">Darkness</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={lightingConfig.overlayOpacity}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                useProjectStore.getState().setLightingOverlay(lightingConfig.overlayColor, val);
              }}
              className="w-24 h-1.5 accent-violet-400"
            />
            <span className="text-[10px] text-white/70 w-7 text-right">{Math.round(lightingConfig.overlayOpacity * 100)}%</span>
          </div>
          {isPenMode && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/70 font-medium w-14">Brush</span>
              <input
                type="range"
                min={5}
                max={100}
                step={1}
                value={lightingConfig.penBrushSize}
                onChange={(e) => {
                  useProjectStore.getState().setLightingPenBrushSize(parseInt(e.target.value));
                }}
                className="w-24 h-1.5 accent-violet-400"
              />
              <span className="text-[10px] text-white/70 w-7 text-right">{lightingConfig.penBrushSize}</span>
            </div>
          )}
        </div>
      )}

      {/* Properties panel */}
      <LightPropertiesPanel />
    </div>
  );
}
