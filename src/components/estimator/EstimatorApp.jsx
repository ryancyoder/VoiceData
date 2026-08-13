'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import { useEstimate, SHAPE_COLORS, crewDayRate } from '@/lib/estimator/useEstimate';
import { useCatalog } from '@/lib/estimator/useCatalog';
import { useAssemblyKits } from '@/lib/estimator/useAssemblyKits';
import { usePhases } from '@/lib/estimator/usePhases';
import CatalogPanel from './CatalogPanel';
import CatalogEditor from './CatalogEditor';
import ImportModal from './ImportModal';
import AssemblyKitModal from './AssemblyKitModal';
import QuickPicker from './QuickPicker';
import EstimatePanel from './EstimatePanel';
import PhotoLinksModal, { DimsOverlay } from './PhotoLinksModal';
import { dealPhotoUrl } from '@/lib/salesBoard';
import PlanView from './PlanView';
import PrintView from './PrintView';
import { CATEGORY_COLORS } from '@/lib/estimator/catalog';

export default function App({ estimateId }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Catalog data source: 'legacy' (catalog_items) or 'master' (the normalized
  // tables via the -v2 endpoints). Persisted so a reload keeps the choice.
  const [catalogSource, setCatalogSource] = useState(() => {
    if (typeof window === 'undefined') return 'legacy';
    return localStorage.getItem('estimator_catalog_source') === 'master' ? 'master' : 'legacy';
  });
  const switchCatalogSource = (next) => {
    setCatalogSource(next);
    try { localStorage.setItem('estimator_catalog_source', next); } catch { /* ignore */ }
  };
  const { catalogItems, deliveryRate, updateDeliveryRate, updateCatalogItem, addCatalogItem, removeCatalogItem, saveCatalog } = useCatalog(catalogSource);
  const { kits, saveKit, removeKit, updateKit } = useAssemblyKits(catalogSource);
  const { stageOptions } = usePhases();

  const {
    estimate,
    loading,
    saveState,
    updateField,
    addGroup,
    updateGroup,
    toggleGroupCollapse,
    addItem,
    removeRow,
    updateItem,
    updateTakeoff,
    updateWallDimensions,
    reorderRows,
    moveItemToGroup,
    addKitToGroup,
    importEstimate,
    setPlanImage,
    setPlanScale,
    setSupplierDelivery,
    updatePlanMeta,
    syncCrewLaborRow,
    productionDays,
    addShape,
    updateShape,
    removeShape,
    addPlant,
    removePlant,
    addItemPlacement,
    removeItemPlacement,
    subtotal,
    metacategoryTotals,
    stageTotals,
    totalLoads,
    totalDelivery,
    loadBreakdown,
    taxAmount,
    total,
  } = useEstimate(deliveryRate, estimateId);

  // activeDrag: { type: 'catalog', item } | { type: 'takeoff-group' } | { type: 'assembly-kit', kit } | null
  const [activeDrag, setActiveDrag] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printTemplate, setPrintTemplate] = useState('detailed');
  const [savingKitGroupId, setSavingKitGroupId] = useState(null);
  const [linkModalGroupId, setLinkModalGroupId] = useState(null);
  const [photoLinks, setPhotoLinks] = useState([]);
  const loadInputRef = useRef(null);

  const refetchPhotoLinks = useCallback(() => {
    if (!estimateId) return;
    fetch(`/api/estimator/estimates/${estimateId}/photo-links`)
      .then((r) => r.json())
      .then((d) => setPhotoLinks(Array.isArray(d.links) ? d.links : []))
      .catch(() => {});
  }, [estimateId]);
  useEffect(() => { refetchPhotoLinks(); }, [refetchPhotoLinks]);

  // Arriving from a gallery photo's "View on plan" link opens the plan view.
  useEffect(() => {
    if (searchParams.get('plan') === '1') setPlanOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Crew labor: plan mobilization days → an auto-managed labor line ─────────
  // Crew size and labor-day override live on the plan; labor days default to the
  // mobilization (production) day count. The rate comes from the catalog.
  const crewSize = estimate?.plan?.crewSize ?? 3;
  const laborDaysOverride = estimate?.plan?.laborDays ?? null;
  const effectiveLaborDays = laborDaysOverride != null ? laborDaysOverride : productionDays;
  const crewDayRateVal = crewDayRate(catalogItems, crewSize);
  useEffect(() => {
    syncCrewLaborRow({ crewSize, laborDays: effectiveLaborDays, dayRate: crewDayRateVal });
  }, [crewSize, effectiveLaborDays, crewDayRateVal, syncCrewLaborRow]);

  // group_id -> number of linked photos, for the take-off group row badge.
  const photoLinkCounts = photoLinks.reduce((m, l) => {
    m[l.group_id] = (m[l.group_id] || 0) + 1;
    return m;
  }, {});

  // Plan pins: links that have been placed on the plan image.
  const [placingPinLink, setPlacingPinLink] = useState(null);
  const [pinPhotoView, setPinPhotoView] = useState(null); // { photo, group, linkId }
  const photoPins = photoLinks
    .filter((l) => l.plan_x != null && l.plan_y != null)
    .map((l) => ({ id: l.id, x: l.plan_x, y: l.plan_y, groupId: l.group_id, photoId: l.photo_id, photo: l.deal_photos }));

  const placePhotoPin = useCallback(async (imgPt) => {
    const link = placingPinLink;
    setPlacingPinLink(null);
    if (!link || !estimateId) return;
    try {
      await fetch(`/api/estimator/estimates/${estimateId}/photo-links`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId: link.id, planX: imgPt.x, planY: imgPt.y }),
      });
      refetchPhotoLinks();
    } catch { /* ignore */ }
  }, [placingPinLink, estimateId, refetchPhotoLinks]);

  const openPinPhoto = useCallback((pin) => {
    const group = estimate?.rows.find(r => r.type === 'group' && r.id === pin.groupId) ?? null;
    setPinPhotoView({ photo: pin.photo, group, linkId: pin.id });
  }, [estimate]);

  const removePinFromPlan = useCallback(async (linkId) => {
    setPinPhotoView(null);
    if (!estimateId) return;
    try {
      await fetch(`/api/estimator/estimates/${estimateId}/photo-links`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId, planX: null, planY: null }),
      });
      refetchPhotoLinks();
    } catch { /* ignore */ }
  }, [estimateId, refetchPhotoLinks]);

  const activeGroup = estimate ? (estimate.rows.find(r => r.type === 'group' && r.id === activeGroupId) ?? null) : null;

  const openPicker = useCallback(() => setPickerOpen(true), []);

  useEffect(() => {
    function onKeyDown(e) {
      // g → new Take Off Group (when not typing in an input)
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        const id = addGroup();
        setActiveGroupId(id);
        setTimeout(() => {
          const input = document.querySelector(`[data-group-label="${id}"]`);
          if (input) { input.focus(); input.select(); }
        }, 0);
        return;
      }
      // / → open picker (when not typing in an input)
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        setPickerOpen(true);
        return;
      }
      // Cmd+K → open picker from anywhere
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPickerOpen(true);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [addGroup]);

  function handleSaveEstimate() {
    const name = (estimate.projectName?.trim() || 'estimate')
      .replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const filename = `${name}-${estimate.date || 'draft'}.json`;
    const blob = new Blob([JSON.stringify(estimate, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLoadFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.rows)) throw new Error('Not a valid estimate file');
        importEstimate(data);
      } catch (err) {
        alert('Could not load file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleNewEstimate() {
    try {
      const res = await fetch('/api/estimator/estimates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error('create failed');
      const { id } = await res.json();
      router.push(`/estimator/${id}`);
    } catch {
      alert('Could not create a new estimate.');
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  // Everything below reads `estimate`; hold rendering until it has loaded.
  if (loading || !estimate) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center bg-slate-50 text-slate-400 print:hidden">
        Loading estimate…
      </div>
    );
  }

  function handleDragStart(event) {
    const data = event.active.data.current;
    if (data?.type === 'catalog') {
      setActiveDrag({ type: 'catalog', item: data.catalogItem });
    } else if (data?.type === 'takeoff-group') {
      setActiveDrag({ type: 'takeoff-group' });
    } else if (data?.type === 'assembly-kit') {
      setActiveDrag({ type: 'assembly-kit', kit: data.kit });
    } else {
      setActiveDrag(null);
    }
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    setActiveDrag(null);

    if (!over) return;

    const activeData = active.data.current;

    if (activeData?.type === 'takeoff-group') {
      addGroup();
    } else if (activeData?.type === 'assembly-kit') {
      const overRow = estimate.rows.find(r => r.id === over.id);
      if (overRow?.type === 'group') {
        addKitToGroup(activeData.kit, overRow.id);
      } else {
        const parentGroup = estimate.rows.find(
          r => r.type === 'group' && r.items.some(i => i.id === over.id)
        );
        addKitToGroup(activeData.kit, parentGroup ? parentGroup.id : null);
      }
    } else if (activeData?.type === 'catalog') {
      // Check if dropped directly on a group header
      const overRow = estimate.rows.find(r => r.id === over.id);
      if (overRow?.type === 'group') {
        addItem(activeData.catalogItem, overRow.id);
      } else {
        // Check if dropped on an item that is inside a group
        const parentGroup = estimate.rows.find(
          r => r.type === 'group' && r.items.some(i => i.id === over.id)
        );
        addItem(activeData.catalogItem, parentGroup ? parentGroup.id : null);
      }
    } else {
      // Reordering / moving estimate rows
      if (active.id !== over.id) {
        // Find which group (if any) the active item lives in
        let activeGroupId = null;
        for (const row of estimate.rows) {
          if (row.type === 'item' && row.id === active.id) { activeGroupId = null; break; }
          if (row.type === 'group' && row.items.some(i => i.id === active.id)) {
            activeGroupId = row.id; break;
          }
        }

        // Find which group (if any) the over target belongs to
        const overIsGroup = estimate.rows.find(r => r.id === over.id && r.type === 'group');
        const overGroupViaItem = estimate.rows.find(
          r => r.type === 'group' && r.items.some(i => i.id === over.id)
        );
        const overGroupId = overIsGroup ? over.id : (overGroupViaItem?.id ?? null);

        if (activeGroupId !== overGroupId && (overIsGroup || overGroupViaItem)) {
          // Cross-group move
          moveItemToGroup(active.id, overGroupId);
        } else {
          reorderRows(active.id, over.id);
        }
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* Screen layout — fills the space below VoiceData's NavBar */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden print:hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 py-3 bg-green-800 text-white shrink-0 shadow">
          <div className="flex items-center gap-3">
            <Link
              href="/estimator"
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-green-200 hover:text-white hover:bg-green-700 transition-colors"
              title="Back to all estimates"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Estimates
            </Link>
            <span className="text-2xl">🌿</span>
            <h1 className="text-lg font-bold tracking-tight">Landscape Estimator</h1>
            <span className="text-xs text-green-200/90 w-16" aria-live="polite">
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : ''}
            </span>
            {/* Catalog data source toggle (Phase 3: compare legacy vs master). */}
            <div className="flex items-center rounded-lg overflow-hidden border border-green-600 text-xs font-semibold" title="Catalog data source">
              <button
                onClick={() => switchCatalogSource('legacy')}
                className={`px-2.5 py-1 transition-colors ${catalogSource === 'legacy' ? 'bg-white text-green-800' : 'text-green-200 hover:bg-green-700'}`}
              >
                Legacy
              </button>
              <button
                onClick={() => switchCatalogSource('master')}
                className={`px-2.5 py-1 transition-colors ${catalogSource === 'master' ? 'bg-white text-green-800' : 'text-green-200 hover:bg-green-700'}`}
              >
                Master
              </button>
            </div>
            {catalogSource === 'master' && (
              <span className="rounded bg-amber-400/90 px-2 py-0.5 text-[0.65rem] font-bold text-amber-950" title="The master catalog is read-only until the write path is migrated">
                READ-ONLY
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewEstimate}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-700 hover:bg-green-600
                         rounded-lg text-sm font-medium transition-colors"
              title="New estimate"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New
            </button>
            <button
              onClick={() => setPlanOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-700 hover:bg-green-600
                         rounded-lg text-sm font-medium transition-colors"
              title="Open plan view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              Plan
            </button>
            <button
              onClick={() => setEditorOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-700 hover:bg-green-600
                         rounded-lg text-sm font-medium transition-colors"
              title="Edit catalog"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Catalog
            </button>
            {/* Quick picker */}
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-700 hover:bg-green-600
                         rounded-lg text-sm font-medium transition-colors"
              title="Quick add item (/ or Cmd+K)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Quick Add
            </button>

            {/* Save estimate to file */}
            <button
              onClick={handleSaveEstimate}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-700 hover:bg-green-600
                         rounded-lg text-sm font-medium transition-colors"
              title="Save estimate to file"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Save
            </button>

            {/* Load estimate from file */}
            <button
              onClick={() => loadInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-700 hover:bg-green-600
                         rounded-lg text-sm font-medium transition-colors"
              title="Load estimate from file"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
              </svg>
              Load
            </button>
            <input
              ref={loadInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleLoadFile}
            />

            <button
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-700 hover:bg-green-600
                         rounded-lg text-sm font-medium transition-colors"
              title="Import from transcript"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import
            </button>
            <button
              onClick={() => setPrintModalOpen(true)}
              className="flex items-center gap-2 px-4 py-1.5 bg-white text-green-800
                         rounded-lg text-sm font-semibold hover:bg-green-50 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print
            </button>
          </div>
        </header>

        {/* Main content */}
        {planOpen ? (
          <PlanView
            estimate={estimate}
            catalogPlants={catalogItems.filter(c => c.category === 'plants')}
            catalogItems={catalogItems}
            onSetPlanImage={setPlanImage}
            onSetPlanScale={setPlanScale}
            onAddShape={addShape}
            onUpdateShape={updateShape}
            onRemoveShape={removeShape}
            onAddPlant={(plant) => addPlant(plant, catalogItems)}
            onRemovePlant={(plantId) => removePlant(plantId, catalogItems)}
            onAddItemPlacement={(item) => addItemPlacement(item, catalogItems)}
            onRemoveItemPlacement={(itemId) => removeItemPlacement(itemId, catalogItems)}
            onAddGroup={addGroup}
            onClose={() => setPlanOpen(false)}
            kits={kits}
            onApplyKit={(kit) => addKitToGroup(kit, null)}
            loadBreakdown={loadBreakdown}
            supplierDeliveries={estimate?.plan?.supplierDeliveries ?? {}}
            onSetSupplierDelivery={setSupplierDelivery}
            trucksPerRow={estimate?.plan?.trucksPerRow ?? 2}
            onSetTrucksPerRow={(n) => updatePlanMeta({ trucksPerRow: n })}
            crewSize={crewSize}
            onSetCrewSize={(n) => updatePlanMeta({ crewSize: n })}
            laborDaysOverride={laborDaysOverride}
            onSetLaborDays={(n) => updatePlanMeta({ laborDays: n })}
            productionDays={productionDays}
            crewDayRateValue={crewDayRateVal}
            photoPins={photoPins}
            placingPhoto={!!placingPinLink}
            onPlacePhotoPin={placePhotoPin}
            onOpenPhotoPin={openPinPhoto}
            onCancelPlacePhoto={() => setPlacingPinLink(null)}
          />
        ) : (
          <main className="flex flex-1 overflow-hidden">
            <CatalogPanel catalogItems={catalogItems} kits={kits} onRemoveKit={removeKit} onUpdateKit={updateKit} />
            <EstimatePanel
              estimate={estimate}
              planShapes={estimate.plan?.shapes ?? []}
              onUpdateField={updateField}
              onUpdateGroup={updateGroup}
              onToggleGroupCollapse={toggleGroupCollapse}
              onUpdateItem={updateItem}
              onUpdateTakeoff={updateTakeoff}
              onUpdateWallDimensions={updateWallDimensions}
              onRemoveRow={removeRow}
              onSaveAsKit={(groupId) => setSavingKitGroupId(groupId)}
              onLinkPhotos={(groupId) => setLinkModalGroupId(groupId)}
              photoLinkCounts={photoLinkCounts}
              activeGroupId={activeGroupId}
              onSetActiveGroup={setActiveGroupId}
              subtotal={subtotal}
              metacategoryTotals={metacategoryTotals}
              stageTotals={stageTotals}
              stageOptions={stageOptions}
              totalLoads={totalLoads}
              taxAmount={taxAmount}
              total={total}
            />
          </main>
        )}
      </div>

      {/* Print-only view */}
      <PrintView
        estimate={estimate}
        subtotal={subtotal}
        metacategoryTotals={metacategoryTotals}
        totalLoads={totalLoads}
        taxAmount={taxAmount}
        total={total}
        template={printTemplate}
      />

      {/* Drag overlay */}
      <DragOverlay>
        {activeDrag?.type === 'takeoff-group' ? (
          <TakeOffGroupDragOverlay />
        ) : activeDrag?.type === 'catalog' ? (
          <CatalogDragOverlay item={activeDrag.item} />
        ) : activeDrag?.type === 'assembly-kit' ? (
          <AssemblyKitDragOverlay kit={activeDrag.kit} />
        ) : null}
      </DragOverlay>

      {/* Quick picker */}
      {pickerOpen && (
        <QuickPicker
          catalogItems={catalogItems}
          activeGroup={activeGroup}
          onAdd={(item, groupId) => addItem(item, groupId)}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Import modal */}
      {importOpen && (
        <ImportModal
          catalogItems={catalogItems}
          onImport={(data) => { importEstimate(data); setImportOpen(false); }}
          onClose={() => setImportOpen(false)}
        />
      )}

      {/* Assembly Kit save modal */}
      {savingKitGroupId != null && (() => {
        const group = estimate.rows.find(r => r.type === 'group' && r.id === savingKitGroupId);
        if (!group) return null;
        return (
          <AssemblyKitModal
            groupLabel={group.label}
            itemCount={group.items.length}
            defaultColor={SHAPE_COLORS[kits.length % SHAPE_COLORS.length]}
            onSave={(name, description, options) => {
              saveKit(name, description, group.items, options);
              setSavingKitGroupId(null);
            }}
            onClose={() => setSavingKitGroupId(null)}
          />
        );
      })()}

      {/* Photo links modal */}
      {linkModalGroupId != null && (() => {
        const group = estimate.rows.find(r => r.type === 'group' && r.id === linkModalGroupId);
        if (!group) return null;
        return (
          <PhotoLinksModal
            estimateId={estimateId}
            group={group}
            onClose={() => setLinkModalGroupId(null)}
            onChanged={refetchPhotoLinks}
            onPlaceOnPlan={(link) => { setPlacingPinLink(link); setLinkModalGroupId(null); setPlanOpen(true); }}
          />
        );
      })()}

      {/* Pinned-photo lightbox (from a plan pin) */}
      {pinPhotoView && pinPhotoView.photo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={(e) => e.target === e.currentTarget && setPinPhotoView(null)}>
          <div className="relative max-h-[90vh] max-w-3xl overflow-hidden rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dealPhotoUrl(pinPhotoView.photo.storage_path)} alt={pinPhotoView.photo.caption || ''} className="max-h-[90vh] max-w-full object-contain" />
            {pinPhotoView.group && <DimsOverlay group={pinPhotoView.group} />}
            <button onClick={() => setPinPhotoView(null)} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white" aria-label="Close">×</button>
            <div className="absolute left-2 top-2 flex gap-2">
              <button onClick={() => removePinFromPlan(pinPhotoView.linkId)} className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white hover:bg-black/80">
                Remove pin
              </button>
              <Link href={`/photos?photo=${pinPhotoView.photo.id}`} className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white hover:bg-black/80">
                ⤢ Open in gallery
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Print template picker */}
      {printModalOpen && (
        <PrintTemplateModal
          current={printTemplate}
          onSelect={(t) => {
            setPrintTemplate(t);
            setPrintModalOpen(false);
            requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
          }}
          onClose={() => setPrintModalOpen(false)}
        />
      )}

      {/* Catalog editor modal */}
      {editorOpen && (
        <CatalogEditor
          items={catalogItems}
          deliveryRate={deliveryRate}
          onUpdateDeliveryRate={updateDeliveryRate}
          onUpdate={updateCatalogItem}
          onAdd={addCatalogItem}
          onRemove={removeCatalogItem}
          onSave={() => saveCatalog(catalogItems, deliveryRate)}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </DndContext>
  );
}

function TakeOffGroupDragOverlay() {
  return (
    <div className="rounded-xl border border-indigo-300 bg-indigo-50 shadow-xl px-3 py-2.5 w-72 opacity-90">
      <div className="flex items-center gap-2.5">
        <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span className="text-sm font-semibold text-indigo-800">New Take Off Group</span>
      </div>
    </div>
  );
}

function PrintTemplateModal({ current, onSelect, onClose }) {
  const templates = [
    {
      id: 'detailed',
      label: 'Detailed',
      desc: 'All line items with quantities and pricing',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    {
      id: 'summary',
      label: 'Summary',
      desc: 'Group totals and cost breakdown only',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M4 6h16M4 10h16M4 14h8m-8 4h4" />
        </svg>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 print:hidden">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-80">
        <h2 className="text-base font-bold text-gray-800 mb-1">Print Template</h2>
        <p className="text-xs text-gray-400 mb-4">Choose a layout for your printed estimate.</p>
        <div className="space-y-2">
          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-colors flex items-center gap-3
                ${current === t.id
                  ? 'border-green-600 bg-green-50'
                  : 'border-gray-200 hover:border-green-400 hover:bg-green-50'
                }`}
            >
              <span className={current === t.id ? 'text-green-700' : 'text-gray-400'}>
                {t.icon}
              </span>
              <div>
                <p className="font-semibold text-sm text-gray-800">{t.label}</p>
                <p className="text-xs text-gray-500">{t.desc}</p>
              </div>
              {current === t.id && (
                <svg className="w-4 h-4 text-green-600 ml-auto shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full text-xs text-gray-400 hover:text-gray-600 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AssemblyKitDragOverlay({ kit }) {
  return (
    <div className="rounded-lg border border-green-300 bg-green-50 shadow-2xl px-3 py-2.5 w-60 opacity-90">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
        </svg>
        <span className="text-sm font-semibold text-green-800 truncate">{kit.name}</span>
        <span className="ml-auto text-xs bg-green-200 text-green-700 px-1.5 py-0.5 rounded-full shrink-0">
          {kit.items.length}
        </span>
      </div>
    </div>
  );
}

function CatalogDragOverlay({ item }) {
  const colors = CATEGORY_COLORS[item.category];
  return (
    <div className={`
      rounded-lg border p-3 shadow-2xl cursor-grabbing w-60
      ${colors.bg} ${colors.border} border
    `}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-medium text-sm leading-tight ${colors.text}`}>
            {item.name}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-xs font-semibold ${colors.text}`}>
            ${item.unitPrice.toFixed(2)}
          </p>
          <p className="text-xs text-gray-500">{item.unit}</p>
        </div>
      </div>
    </div>
  );
}
