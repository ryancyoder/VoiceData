'use client';

import { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Toolbar } from './components/Toolbar/Toolbar';
import { ObjectStrip } from './components/StampLibrary/ObjectStrip';
import { EditorCanvas } from './components/Canvas/EditorCanvas';
import { PlanViewCanvas } from './components/PlanView/PlanViewCanvas';
import { LightingCanvas } from './components/Lighting/LightingCanvas';
import { ToolsSidebar } from './components/GestureControls/ToolsSidebar';
import { PlantTable } from './components/PlantTable';
import { JobsitePhotoPicker } from './components/JobsitePhotoPicker';
import { useProjectStore } from './store/useProjectStore';
import { initProject, teardownProject } from './store/projectPersistence';

export default function App({ projectId }: { projectId: string }) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const viewMode = useProjectStore((s) => s.viewMode);
  const [plantTableOpen, setPlantTableOpen] = useState(false);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [dealLinked, setDealLinked] = useState(false);

  // Load this project into the store and start the Supabase autosave; tear it
  // down on unmount / project change.
  useEffect(() => {
    let active = true;
    setDealLinked(false);
    initProject(projectId).then((link) => {
      if (active) setDealLinked(link?.dealId != null);
    });
    return () => {
      active = false;
      teardownProject();
    };
  }, [projectId]);

  // Keyboard shortcuts (desktop). Everything here is also reachable by tapping,
  // so this is purely additive. Ignore keystrokes while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      const s = useProjectStore.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        const id = s.selectedStampId;
        if (id) (s.viewMode === 'plan' ? s.duplicatePlanStamp : s.duplicateStamp)(id);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.viewMode === 'lighting' && s.selectedLightId) {
          e.preventDefault();
          s.removeLight(s.selectedLightId);
          return;
        }
        const id = s.selectedStampId;
        if (id) {
          e.preventDefault();
          (s.viewMode === 'plan' ? s.removePlanStamp : s.removeStamp)(id);
        }
        return;
      }
      if (e.key === 'Escape') {
        s.selectStamp(null);
        s.setPendingStamp(null);
        s.selectLight(null);
        return;
      }
      if (!mod && (e.key === 'f' || e.key === 'F')) {
        const id = s.selectedStampId;
        if (id && s.viewMode !== 'lighting') {
          const list = s.viewMode === 'plan' ? s.planStamps : s.stamps;
          const st = list.find((x) => x.id === id);
          if (st) {
            s.pushHistory();
            (s.viewMode === 'plan' ? s.updatePlanStamp : s.updateStamp)(id, { flipX: !st.flipX });
          }
        }
        return;
      }
      if (e.key === '1') s.setViewMode('photo');
      else if (e.key === '2') s.setViewMode('plan');
      else if (e.key === '3') s.setViewMode('lighting');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-gray-50 overflow-hidden">
      <Toolbar
        stageRef={stageRef}
        onOpenPlantTable={() => setPlantTableOpen(true)}
        onOpenJobsitePhotos={dealLinked ? () => setPhotoPickerOpen(true) : undefined}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <ToolsSidebar />
        <div className="flex-1 min-w-0 relative">
          {viewMode === 'photo' ? (
            <EditorCanvas stageRef={stageRef} />
          ) : viewMode === 'plan' ? (
            <PlanViewCanvas />
          ) : (
            <LightingCanvas />
          )}
        </div>
        <ObjectStrip />
      </div>
      {plantTableOpen && <PlantTable onClose={() => setPlantTableOpen(false)} />}
      {photoPickerOpen && (
        <JobsitePhotoPicker projectId={projectId} onClose={() => setPhotoPickerOpen(false)} />
      )}
    </div>
  );
}
