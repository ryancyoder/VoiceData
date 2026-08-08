import { useCallback } from 'react';
import {
  Upload,
  MousePointer2,
  Undo2,
  Redo2,
  Download,
  Trash2,
  PersonStanding,
  Eraser,
  CircleOff,
  Combine,
  Image as ImageIcon,
  LayoutGrid,
  Stamp,
  FolderDown,
  FolderUp,
  Table2,
  Lightbulb,
  PenTool,
  ImagePlus,
} from 'lucide-react';
import { useCustomStampStore } from '../../store/useCustomStampStore';
import { SettingsMenu } from '../SettingsMenu';
import { PlanDiameterDisplay } from '../GestureControls/ToolsSidebar';
import Konva from 'konva';
import { useProjectStore } from '../../store/useProjectStore';
import { uploadRender } from '../../store/projectPersistence';
import type { ToolMode } from '../../types';

interface ToolbarProps {
  stageRef: React.RefObject<Konva.Stage | null>;
  onOpenPlantTable?: () => void;
  onOpenJobsitePhotos?: () => void;
}

export function Toolbar({ stageRef, onOpenPlantTable, onOpenJobsitePhotos }: ToolbarProps) {

  const toolMode = useProjectStore((s) => s.toolMode);
  const setToolMode = useProjectStore((s) => s.setToolMode);
  const viewMode = useProjectStore((s) => s.viewMode);
  const setViewMode = useProjectStore((s) => s.setViewMode);
  const setBackgroundImage = useProjectStore((s) => s.setBackgroundImage);
  const setPlanImage = useProjectStore((s) => s.setPlanImage);
  const hasOverlay = !!useProjectStore((s) => s.planView.selectionImage);
  const flattenOverlay = useProjectStore((s) => s.flattenOverlay);
  const backgroundWidth = useProjectStore((s) => s.backgroundWidth);
  const backgroundHeight = useProjectStore((s) => s.backgroundHeight);
  const selectedStampId = useProjectStore((s) => s.selectedStampId);
  const planStamps = useProjectStore((s) => s.planStamps);
  const removeStamp = useProjectStore((s) => s.removeStamp);
  const isPlan = viewMode === 'plan';
  const clusterMode = useProjectStore((s) => s.clusterMode);
  const setClusterMode = useProjectStore((s) => s.setClusterMode);
  const selectedPlanStamp = isPlan && selectedStampId ? planStamps.find((s) => s.id === selectedStampId) : null;
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const historyIndex = useProjectStore((s) => s.historyIndex);
  const historyLength = useProjectStore((s) => s.history.length);

  const handleUploadPhoto = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const img = new window.Image();
        img.onload = () => setBackgroundImage(dataUrl, img.naturalWidth, img.naturalHeight);
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [setBackgroundImage]);

  const handleUploadPlan = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const img = new window.Image();
        img.onload = () => {
          setPlanImage(dataUrl, img.naturalWidth, img.naturalHeight);
          setViewMode('plan');
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [setPlanImage, setViewMode]);

  const handleFlatten = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !backgroundWidth || !backgroundHeight) return;

    // We need to render at native resolution. The stage is currently
    // scaled to 2/3 for overlay positioning. Temporarily reset to 1:1,
    // render, then restore.
    const prevScaleX = stage.scaleX();
    const prevScaleY = stage.scaleY();
    const prevX = stage.x();
    const prevY = stage.y();

    stage.scaleX(1);
    stage.scaleY(1);
    stage.x(0);
    stage.y(0);

    // Hide stamps and guides layers — only keep background + overlay
    const layers = stage.getLayers();
    if (layers[2]) layers[2].visible(false);
    if (layers[3]) layers[3].visible(false);

    stage.draw();

    const dataUrl = stage.toDataURL({
      x: 0,
      y: 0,
      width: backgroundWidth,
      height: backgroundHeight,
      pixelRatio: 1,
    });

    // Restore everything
    stage.scaleX(prevScaleX);
    stage.scaleY(prevScaleY);
    stage.x(prevX);
    stage.y(prevY);
    if (layers[2]) layers[2].visible(true);
    if (layers[3]) layers[3].visible(true);
    stage.draw();

    flattenOverlay(dataUrl);
  }, [stageRef, backgroundWidth, backgroundHeight, flattenOverlay]);

  const handleExport = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // Temporarily hide guides and selection for clean export
    const layers = stage.getLayers();
    const guidesLayer = layers[layers.length - 1]; // Last layer is guides
    guidesLayer.visible(false);

    // Deselect to hide transformer
    const prevSelected = useProjectStore.getState().selectedStampId;
    useProjectStore.getState().selectStamp(null);

    // Small delay to let Konva update
    setTimeout(() => {
      const dataUrl = stage.toDataURL({ pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = 'landscape-design.png';
      link.href = dataUrl;
      link.click();

      // Also persist the render as this design's preview (shown on the deal).
      void uploadRender(dataUrl);

      // Restore guides and selection
      guidesLayer.visible(true);
      if (prevSelected) {
        useProjectStore.getState().selectStamp(prevSelected);
      }
    }, 50);
  }, [stageRef]);

  const isLighting = viewMode === 'lighting';

  const tools: { mode: ToolMode; icon: typeof MousePointer2; label: string; planOnly?: boolean; photoOnly?: boolean; lightingOnly?: boolean }[] = [
    { mode: 'select', icon: MousePointer2, label: 'Select' },
    { mode: 'calibrate', icon: PersonStanding, label: 'Calibrate', photoOnly: true },
    { mode: 'eraser', icon: Eraser, label: 'Erase Overlay', photoOnly: true },
    { mode: 'objEraser', icon: CircleOff, label: 'Object Eraser', planOnly: true },
    { mode: 'placeLight', icon: Lightbulb, label: 'Place Light', lightingOnly: true },
    { mode: 'lightPen', icon: PenTool, label: 'Light Pen', lightingOnly: true },
  ];

  const filteredTools = tools.filter(t =>
    (!t.planOnly || isPlan) && (!t.photoOnly || !isPlan && !isLighting) && (!t.lightingOnly || isLighting)
  );

  return (
    <div className="h-14 bg-white border-b border-gray-200 flex items-center px-2 gap-1 shrink-0">
      {/* Upload perspective photo */}
      <ToolButton onClick={handleUploadPhoto} label="Upload Photo">
        <Upload size={20} />
      </ToolButton>
      {/* Pick a background from the deal's jobsite photos (deal-linked only) */}
      {onOpenJobsitePhotos && (
        <ToolButton onClick={onOpenJobsitePhotos} label="Use Jobsite Photo">
          <ImagePlus size={20} />
        </ToolButton>
      )}
      {/* Upload plan image */}
      <ToolButton onClick={handleUploadPlan} label="Upload Plan Image">
        <LayoutGrid size={20} />
      </ToolButton>

      <div className="w-px h-8 bg-gray-200 mx-1" />

      {/* Tool modes */}
      {filteredTools.map(({ mode, icon: Icon, label }) => (
        <ToolButton
          key={mode}
          onClick={() => {
            setToolMode(mode);
            if (mode === 'placeLight') {
              useProjectStore.getState().setPendingLightType(
                useProjectStore.getState().pendingLightType ?? 'path'
              );
            }
          }}
          active={toolMode === mode}
          label={label}
        >
          <Icon size={20} />
        </ToolButton>
      ))}

      {/* Cluster outline toggle (plan view only) */}
      {isPlan && (
        <ToolButton
          onClick={() => setClusterMode(!clusterMode)}
          active={clusterMode}
          label="Cluster Outlines"
        >
          <Combine size={20} />
        </ToolButton>
      )}

      <div className="w-px h-8 bg-gray-200 mx-1" />

      {/* Photo / Plan / Lighting toggle */}
      <div className="flex bg-gray-100 rounded-lg p-0.5">
        <button
          onClick={() => setViewMode('photo')}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'photo' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
          }`}
        >
          <ImageIcon size={14} />
          Photo
        </button>
        <button
          onClick={() => setViewMode('plan')}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'plan' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500'
          }`}
        >
          <LayoutGrid size={14} />
          Plan
        </button>
        <button
          onClick={() => setViewMode('lighting')}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            viewMode === 'lighting' ? 'bg-white text-amber-600 shadow-sm' : 'text-gray-500'
          }`}
        >
          <Lightbulb size={14} />
          Lighting
        </button>
      </div>

      <div className="w-px h-8 bg-gray-200 mx-1" />

      {/* Undo / Redo */}
      <ToolButton onClick={undo} disabled={historyIndex < 0} label="Undo">
        <Undo2 size={20} />
      </ToolButton>
      <ToolButton onClick={redo} disabled={historyIndex >= historyLength - 1} label="Redo">
        <Redo2 size={20} />
      </ToolButton>

      {/* Delete selected */}
      {selectedStampId && (
        <>
          <div className="w-px h-8 bg-gray-200 mx-1" />
          <ToolButton onClick={() => removeStamp(selectedStampId)} label="Delete">
            <Trash2 size={20} />
          </ToolButton>
        </>
      )}

      {/* Center: diameter display for plan view */}
      <div className="flex-1 flex items-center justify-center">
        <PlanDiameterDisplay stamp={selectedPlanStamp ?? null} selectedStampId={selectedStampId} isPlan={isPlan} />
      </div>

      {/* Library import/export + plant table */}
      <ToolButton onClick={() => useCustomStampStore.getState().importLibrary()} label="Import Library">
        <FolderUp size={20} />
      </ToolButton>
      <ToolButton onClick={() => useCustomStampStore.getState().exportLibrary()} label="Export Library">
        <FolderDown size={20} />
      </ToolButton>
      {onOpenPlantTable && (
        <ToolButton onClick={onOpenPlantTable} label="Plant Database">
          <Table2 size={20} />
        </ToolButton>
      )}

      <div className="w-px h-8 bg-gray-200 mx-1" />

      {/* Paste/Flatten overlay */}
      {hasOverlay && viewMode === 'photo' && (
        <ToolButton onClick={handleFlatten} label="Paste Overlay" accent>
          <Stamp size={20} />
        </ToolButton>
      )}

      {/* Export */}
      <ToolButton onClick={handleExport} label="Export PNG" accent>
        <Download size={20} />
      </ToolButton>

      {/* Settings */}
      <SettingsMenu />
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  active = false,
  disabled = false,
  accent = false,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  accent?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`
        w-11 h-11 flex items-center justify-center rounded-lg transition-colors
        ${active ? 'bg-blue-100 text-blue-600' : ''}
        ${accent ? 'bg-green-500 text-white hover:bg-green-600' : ''}
        ${!active && !accent ? 'text-gray-600 hover:bg-gray-100' : ''}
        ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {children}
    </button>
  );
}
