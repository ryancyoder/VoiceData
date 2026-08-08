import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { usePlanSymbolStore } from '../../store/useCustomStampStore';
import { DuplicateStampMode } from '../Canvas/EditorCanvas';

const TRACK_HEIGHT = 180;
const THUMB_SIZE = 40;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5.0;

function scaleToPosition(scale: number) {
  return 1 - (scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE);
}
function positionToScale(pos: number) {
  return MIN_SCALE + (1 - pos) * (MAX_SCALE - MIN_SCALE);
}

export function ToolsSidebar() {
  const selectedStampId = useProjectStore((s) => s.selectedStampId);
  const viewMode = useProjectStore((s) => s.viewMode);
  const perspStamps = useProjectStore((s) => s.stamps);
  const planStamps = useProjectStore((s) => s.planStamps);
  const updateStamp = useProjectStore((s) => s.updateStamp);
  const updatePlanStamp = useProjectStore((s) => s.updatePlanStamp);
  const pushHistory = useProjectStore((s) => s.pushHistory);
  const duplicateStamp = useProjectStore((s) => s.duplicateStamp);
  const duplicatePlanStamp = useProjectStore((s) => s.duplicatePlanStamp);
  const removeStamp = useProjectStore((s) => s.removeStamp);
  const removePlanStamp = useProjectStore((s) => s.removePlanStamp);

  const isPlan = viewMode === 'plan';
  const allStamps = isPlan ? planStamps : perspStamps;
  const doUpdate = isPlan ? updatePlanStamp : updateStamp;
  const doRemove = isPlan ? removePlanStamp : removeStamp;
  const doDuplicate = isPlan ? duplicatePlanStamp : duplicateStamp;
  const stamp = selectedStampId ? allStamps.find((s) => s.id === selectedStampId) : null;

  // ---- Size slider ----
  const trackRef = useRef<HTMLDivElement>(null);
  const [sliderDragging, setSliderDragging] = useState(false);
  const sliderHistoryRecorded = useRef(false);

  const handleSliderMove = useCallback((clientY: number) => {
    if (!trackRef.current || !selectedStampId) return;
    const rect = trackRef.current.getBoundingClientRect();
    const y = clientY - rect.top - THUMB_SIZE / 2;
    const clamped = Math.max(0, Math.min(TRACK_HEIGHT - THUMB_SIZE, y));
    doUpdate(selectedStampId, { manualScale: Math.round(positionToScale(clamped / (TRACK_HEIGHT - THUMB_SIZE)) * 100) / 100 });
  }, [selectedStampId, doUpdate]);

  useEffect(() => {
    if (!sliderDragging) return;
    const onMove = (e: PointerEvent) => { e.preventDefault(); handleSliderMove(e.clientY); };
    const onUp = () => { setSliderDragging(false); sliderHistoryRecorded.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [sliderDragging, handleSliderMove]);

  // ---- Stamp-gun ----
  const [stampGunActive, setStampGunActive] = useState(false);
  useEffect(() => { DuplicateStampMode.active = stampGunActive; return () => { DuplicateStampMode.active = false; }; }, [stampGunActive]);
  useEffect(() => { if (!selectedStampId) setStampGunActive(false); }, [selectedStampId]);

  const thumbPos = stamp ? scaleToPosition(stamp.manualScale) : 0.5;
  const thumbY = thumbPos * (TRACK_HEIGHT - THUMB_SIZE);
  const scalePercent = stamp ? Math.round(stamp.manualScale * 100) : 100;

  return (
    <div
      className="w-28 bg-white/80 backdrop-blur-sm border-r border-gray-200/50 flex flex-col items-center py-2 shrink-0"
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
    >
      {/* Scale label */}
      <div className={`text-[11px] font-semibold mb-1 px-2 py-0.5 rounded-full ${
        stamp ? 'bg-black/40 text-white' : 'bg-gray-200 text-gray-400'
      }`}>
        {stamp ? `${scalePercent}%` : '—'}
      </div>

      {/* Size slider */}
      <div
        ref={trackRef}
        className="relative w-10 rounded-full bg-black/15 border border-white/20"
        style={{ height: TRACK_HEIGHT }}
        onPointerDown={(e) => {
          if (!stamp) return;
          e.preventDefault(); e.stopPropagation();
          if (!sliderHistoryRecorded.current) { pushHistory(); sliderHistoryRecorded.current = true; }
          setSliderDragging(true);
          handleSliderMove(e.clientY);
        }}
      >
        <div className="absolute -right-4 top-0 text-[9px] text-gray-400 font-medium">+</div>
        <div className="absolute -right-3 bottom-0 text-[9px] text-gray-400 font-medium">-</div>
        {stamp && <div className="absolute bottom-0 left-0 right-0 rounded-full bg-blue-400/30" style={{ height: `${(1 - thumbPos) * 100}%` }} />}
        {stamp && (
          <div className={`absolute left-1/2 -translate-x-1/2 rounded-full border-2 shadow-md ${sliderDragging ? 'bg-blue-500 border-white' : 'bg-white border-blue-400'}`}
            style={{ width: THUMB_SIZE, height: THUMB_SIZE, top: thumbY }}>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <div className={`w-3.5 h-0.5 rounded ${sliderDragging ? 'bg-white/60' : 'bg-gray-300'}`} />
              <div className={`w-3.5 h-0.5 rounded ${sliderDragging ? 'bg-white/60' : 'bg-gray-300'}`} />
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1 mt-2">
        <button
          onPointerUp={(e) => { e.stopPropagation(); if (selectedStampId) doDuplicate(selectedStampId); }}
          className={`w-11 h-11 rounded-full backdrop-blur-sm border flex items-center justify-center transition-colors select-none ${
            stamp ? 'bg-black/30 border-white/20 active:bg-blue-500' : 'bg-gray-200 border-gray-300 opacity-40'
          }`}
          disabled={!stamp}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button
          onPointerUp={(e) => { e.stopPropagation(); if (stamp) setStampGunActive(!stampGunActive); }}
          className={`w-11 h-11 rounded-full backdrop-blur-sm border flex items-center justify-center transition-all select-none relative ${
            stampGunActive ? 'bg-blue-500 border-white shadow-lg shadow-blue-500/50' :
            stamp ? 'bg-black/30 border-white/20' : 'bg-gray-200 border-gray-300 opacity-40'
          }`}
          disabled={!stamp}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {stampGunActive && <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-blue-400 animate-pulse" />}
        </button>
      </div>

      {/* Delete selected */}
      <button
        onClick={() => { if (selectedStampId) doRemove(selectedStampId); }}
        className={`mt-1 w-11 h-11 rounded-full backdrop-blur-sm border flex items-center justify-center transition-colors select-none ${
          stamp ? 'bg-red-500/70 border-white/20 active:bg-red-600' : 'bg-gray-200 border-gray-300 opacity-40'
        }`}
        disabled={!stamp}
        title="Delete selected"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>

      {/* Move-only toggle */}
      <MoveOnlyButton />

      {/* Undo / Redo */}
      <UndoRedoButtons />

      <div className="flex-1" />

      {/* Lower section: category icons (photo/plan) or light presets (lighting) */}
      {viewMode === 'lighting' ? <LightPresetButtons /> : <TopCategoryIcons />}
    </div>
  );
}

function TopCategoryIcons() {
  const activeTopCategory = useProjectStore((s) => s.activeTopCategory ?? 'deciduous');
  const setActiveTopCategory = useProjectStore((s) => s.setActiveTopCategory);

  const categories: { id: string; label: string; icon: () => React.ReactElement }[] = [
    { id: 'deciduous', label: 'Deciduous', icon: DeciduousIcon },
    { id: 'evergreens', label: 'Evergreens', icon: EvergreenIcon },
    { id: 'grasses', label: 'Grasses', icon: GrassIcon },
    { id: 'shrubs', label: 'Shrubs', icon: ShrubIcon },
    { id: 'perennials', label: 'Perennials', icon: PerennialIcon },
    { id: 'other', label: 'Other', icon: OtherIcon },
  ];

  return (
    <div className="w-full border-t border-gray-200/50 pt-1 pb-1 flex flex-col items-center gap-1">
      <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
        Library
      </div>
      {categories.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setActiveTopCategory(id)}
          className={`w-[3.375rem] h-[3.375rem] rounded-full backdrop-blur-sm border flex items-center justify-center transition-colors select-none ${
            activeTopCategory === id
              ? 'bg-emerald-500 border-white text-white shadow-lg shadow-emerald-500/40'
              : 'bg-black/30 border-white/20 text-white active:bg-black/50'
          }`}
          title={label}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}

function DeciduousIcon() {
  // Broad leafy canopy with single trunk
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
      <path d="M12 3c-4 0-7 3-7 6 0 1 .3 2 .8 2.8C4.2 12.5 3 14 3 15.5 3 17.5 4.8 19 7 19h10c2.2 0 4-1.5 4-3.5 0-1.5-1.2-3-2.8-3.7.5-.8.8-1.8.8-2.8 0-3-3-6-7-6z" fill="currentColor" stroke="none" />
      <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function EvergreenIcon() {
  // Triangular pine/fir shape
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
      <path d="M12 2 L6 10 H9 L5 16 H9 L4 22 H20 L15 16 H19 L15 10 H18 Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function GrassIcon() {
  // Several vertical blades
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 22 C 5 16, 6 13, 7 10" />
      <path d="M9 22 C 9 15, 10 11, 11 7" />
      <path d="M14 22 C 13 15, 13 11, 12 7" />
      <path d="M18 22 C 17 16, 17 13, 16 10" />
    </svg>
  );
}

function ShrubIcon() {
  // Rounded bushy shape, wider than tall
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
      <path d="M4 18 C 3 13, 5 10, 8 10 C 8 7, 11 6, 13 8 C 15 6, 18 7, 19 10 C 22 10, 22 14, 20 18 Z" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PerennialIcon() {
  // Flower with 5 petals
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="9" r="2" fill="currentColor" />
      <path d="M12 5 C 10 3, 9 5, 10 7" />
      <path d="M12 5 C 14 3, 15 5, 14 7" />
      <path d="M8 10 C 5 10, 5 12, 8 12" />
      <path d="M16 10 C 19 10, 19 12, 16 12" />
      <path d="M10 12 C 10 15, 14 15, 14 12" />
      <line x1="12" y1="11" x2="12" y2="22" />
      <path d="M12 16 C 10 15, 8 16, 9 18" />
      <path d="M12 18 C 14 17, 16 18, 15 20" />
    </svg>
  );
}

function OtherIcon() {
  // Grid/texture pattern
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function PlanDiameterDisplay({ stamp, selectedStampId, isPlan }: {
  stamp: { assetId: string; manualScale: number } | null;
  selectedStampId: string | null;
  isPlan: boolean;
}) {
  const planPixelsPerFoot = useProjectStore((s) => s.planPixelsPerFoot);
  const setSymbolDefaultScale = usePlanSymbolStore((s) => s.setSymbolDefaultScale);
  const [locked, setLocked] = useState(false);

  if (!isPlan || !stamp || !selectedStampId) return null;

  const symbol = usePlanSymbolStore.getState().getSymbol(stamp.assetId);
  if (!symbol) return null;

  // Calculate rendered width in pixels
  const baseSize = 80;
  const aspect = symbol.naturalWidth / symbol.naturalHeight;
  const widthPx = baseSize * aspect * stamp.manualScale;

  // Convert to feet if scale is set
  const hasFeetScale = planPixelsPerFoot && planPixelsPerFoot > 0;
  const widthFt = hasFeetScale ? widthPx / planPixelsPerFoot! : null;
  const isDefaultLocked = symbol.defaultScale !== undefined;

  return (
    <div className="flex items-center gap-2">
      <div className="text-xs font-semibold text-gray-600">
        {widthFt !== null
          ? `${widthFt.toFixed(1)} ft`
          : `${Math.round(widthPx)}px`
        }
      </div>
      <button
        onClick={() => {
          setSymbolDefaultScale(stamp.assetId, stamp.manualScale);
          setLocked(true);
          setTimeout(() => setLocked(false), 1500);
        }}
        className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors select-none ${
          locked ? 'bg-green-500 text-white'
            : isDefaultLocked ? 'bg-purple-100 text-purple-600 border border-purple-300'
            : 'bg-gray-100 text-gray-500 border border-gray-300'
        }`}
      >
        {locked ? 'Locked!' : isDefaultLocked ? 'Update' : 'Lock Size'}
      </button>
    </div>
  );
}

function UndoRedoButtons() {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const historyIndex = useProjectStore((s) => s.historyIndex);
  const historyLength = useProjectStore((s) => s.history.length);

  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < historyLength - 1;

  return (
    <div className="flex gap-1 mt-2">
      <button
        onClick={undo}
        disabled={!canUndo}
        className={`w-11 h-11 rounded-full backdrop-blur-sm border flex items-center justify-center transition-colors select-none ${
          canUndo ? 'bg-black/30 border-white/20 active:bg-blue-500' : 'bg-gray-200 border-gray-300 opacity-30'
        }`}
        title="Undo"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" />
          <path d="M3 13a9 9 0 0 1 15.36-6.36" />
        </svg>
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        className={`w-11 h-11 rounded-full backdrop-blur-sm border flex items-center justify-center transition-colors select-none ${
          canRedo ? 'bg-black/30 border-white/20 active:bg-blue-500' : 'bg-gray-200 border-gray-300 opacity-30'
        }`}
        title="Redo"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" />
          <path d="M21 13a9 9 0 0 0-15.36-6.36" />
        </svg>
      </button>
    </div>
  );
}

function MoveOnlyButton() {
  const moveOnly = useProjectStore((s) => s.moveOnly);
  const setMoveOnly = useProjectStore((s) => s.setMoveOnly);

  return (
    <button
      onClick={() => setMoveOnly(!moveOnly)}
      className={`mt-2 w-20 h-9 rounded-full backdrop-blur-sm border flex items-center justify-center gap-1 transition-all select-none text-[10px] font-semibold ${
        moveOnly
          ? 'bg-amber-500 border-white text-white shadow-lg shadow-amber-500/50'
          : 'bg-black/30 border-white/20 text-white'
      }`}
      style={{ WebkitTouchCallout: 'none' }}
      title={moveOnly ? 'Move mode — tap to exit' : 'Enter move-only mode'}
    >
      {/* Move icon */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 9l-3 3 3 3" />
        <path d="M9 5l3-3 3 3" />
        <path d="M15 19l-3 3-3-3" />
        <path d="M19 9l3 3-3 3" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="12" y1="2" x2="12" y2="22" />
      </svg>
      {moveOnly ? 'MOVE' : 'Move'}
    </button>
  );
}

function LightPresetButtons() {
  const pendingLightType = useProjectStore((s) => s.pendingLightType);
  const setPendingLightType = useProjectStore((s) => s.setPendingLightType);
  const setToolMode = useProjectStore((s) => s.setToolMode);
  const selectedLightId = useProjectStore((s) => s.selectedLightId);
  const removeLight = useProjectStore((s) => s.removeLight);

  const presets: { id: 'uplight' | 'path' | 'spotlight'; label: string; icon: () => React.ReactElement }[] = [
    { id: 'uplight', label: 'Uplight', icon: UplightIcon },
    { id: 'path', label: 'Path', icon: PathLightIcon },
    { id: 'spotlight', label: 'Spot', icon: SpotlightIcon },
  ];

  return (
    <div className="w-full border-t border-gray-200/50 pt-1 pb-1 flex flex-col items-center gap-1">
      <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
        Lights
      </div>
      {presets.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => {
            setPendingLightType(id);
            setToolMode('placeLight');
          }}
          className={`w-[3.375rem] h-[3.375rem] rounded-full backdrop-blur-sm border flex items-center justify-center transition-colors select-none ${
            pendingLightType === id
              ? 'bg-amber-500 border-white text-white shadow-lg shadow-amber-500/40'
              : 'bg-black/30 border-white/20 text-white active:bg-black/50'
          }`}
          title={label}
        >
          <Icon />
        </button>
      ))}
      {/* Delete selected light */}
      {selectedLightId && (
        <button
          onClick={() => removeLight(selectedLightId)}
          className="mt-1 w-11 h-11 rounded-full bg-red-500/70 backdrop-blur-sm border border-white/20 flex items-center justify-center active:bg-red-600 transition-colors select-none"
          title="Delete light"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
      {/* Clear pen strokes */}
      {useProjectStore.getState().lightingConfig.penMask && (
        <button
          onClick={() => {
            if (window.confirm('Clear all pen strokes?')) {
              useProjectStore.getState().clearLightingPenMask();
            }
          }}
          className="mt-1 w-20 h-8 rounded-full bg-black/30 backdrop-blur-sm border border-white/20 flex items-center justify-center active:bg-red-500 transition-colors select-none"
          title="Clear pen strokes"
        >
          <span className="text-[9px] text-white font-semibold">Clear Pen</span>
        </button>
      )}
    </div>
  );
}

function UplightIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v6" />
      <path d="M8 6l4-4 4 4" />
      <path d="M9 18h6" />
      <rect x="10" y="14" width="4" height="8" rx="1" />
    </svg>
  );
}

function PathLightIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="6" r="4" />
      <line x1="12" y1="10" x2="12" y2="22" />
      <path d="M8 6 A4 4 0 0 0 16 6" />
    </svg>
  );
}

function SpotlightIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2l6 6 6-6" />
      <path d="M12 8v4" />
      <path d="M8 14l4 4 4-4" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}
