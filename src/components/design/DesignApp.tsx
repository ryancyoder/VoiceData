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
import { useProjectStore } from './store/useProjectStore';
import { initProject, teardownProject } from './store/projectPersistence';

export default function App({ projectId }: { projectId: string }) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const viewMode = useProjectStore((s) => s.viewMode);
  const [plantTableOpen, setPlantTableOpen] = useState(false);

  // Load this project into the store and start the Supabase autosave; tear it
  // down on unmount / project change.
  useEffect(() => {
    void initProject(projectId);
    return () => teardownProject();
  }, [projectId]);

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-gray-50 overflow-hidden">
      <Toolbar stageRef={stageRef} onOpenPlantTable={() => setPlantTableOpen(true)} />
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
    </div>
  );
}
