import { useState } from 'react';
import PlanCanvas, { PLANT_TYPES, ITEM_TYPES } from './PlanCanvas';
import PlanShapeList from './PlanShapeList';
import { genId, SHAPE_COLORS } from '@/lib/estimator/useEstimate';

const PLANT_SYMBOL_MAP = Object.fromEntries(PLANT_TYPES.map(pt => [pt.key, pt]));
const ITEM_TYPE_MAP = Object.fromEntries(ITEM_TYPES.map(it => [it.key, it]));

// Delivery-load icon per material category (the fallback when the material name
// doesn't match a specific bulk material below). Each icon = one truckload.
const LOAD_ICON_BY_CATEGORY = {
  bulk_materials: '🚛',
  standard_materials: '🚚',
  hardscape: '🧱',
  edging: '🚚',
  drainage: '🚚',
  plants: '🌳',
  lawn: '🌱',
};

// Distinct glyphs per bulk material, matched on the material name so mulch,
// topsoil, stone, sand, etc. each read differently in the loads column.
const BULK_ICON_KEYWORDS = [
  [['mulch'], '🪵'],
  [['compost'], '🍂'],
  [['manure'], '🐴'],
  [['sand'], '🟨'],
  [['salt'], '🧂'],
  [['gravel', 'stone', 'rock', 'limestone', 'boulder', 'aggregate', 'crushed', 'slag', 'pea '], '🪨'],
  [['topsoil', 'top soil', 'soil', 'dirt', 'fill'], '🟫'],
  [['sod', 'turf'], '🟩'],
];
function loadIcon(category, name = '') {
  const n = name.toLowerCase();
  for (const [keys, icon] of BULK_ICON_KEYWORDS) {
    if (keys.some((k) => n.includes(k))) return icon;
  }
  return LOAD_ICON_BY_CATEGORY[category] || '🚛';
}

function ToolBtn({ label, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
        ${active ? 'bg-white text-gray-900' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
    >
      {icon}{label}
    </button>
  );
}

export default function PlanView({
  estimate,
  catalogPlants,
  catalogItems,
  onSetPlanImage, onSetPlanScale,
  onAddShape, onUpdateShape, onRemoveShape,
  onAddPlant, onRemovePlant,
  onAddItemPlacement, onRemoveItemPlacement,
  onAddGroup,
  onClose,
  kits,
  onApplyKit,
  loadBreakdown = [],
  photoPins = [],
  placingPhoto = false,
  onPlacePhotoPin,
  onOpenPhotoPin,
  onCancelPlacePhoto,
}) {
  const [activeTool, setActiveTool] = useState('select');
  const [selectedPlantId, setSelectedPlantId] = useState(null);
  const [selectedItemCatalogId, setSelectedItemCatalogId] = useState(null);
  const [calPoints, setCalPoints] = useState([]);
  const [showCalLine, setShowCalLine] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [activeKitId, setActiveKitId] = useState(null);

  const plantable = (catalogPlants ?? []).filter(c => c.planSymbol);
  const itemable = (catalogItems ?? []).filter(c => c.itemSymbol);

  // Kits visible in area/linear sub-toolbars: match takeoffUnit or unset (either)
  const areaKits = (kits ?? []).filter(k => !k.takeoffUnit || k.takeoffUnit === 'area');
  const linearKits = (kits ?? []).filter(k => !k.takeoffUnit || k.takeoffUnit === 'linear');

  const calPending = calPoints.length === 2;
  const groups = estimate.rows.filter(r => r.type === 'group');

  function handleCalibrationPointsSet(p1, p2) { setCalPoints([p1, p2]); }

  function handleShapeComplete(type, vertices) {
    const activeKit = (kits ?? []).find(k => k.id === activeKitId);
    const color = activeKit?.color ?? SHAPE_COLORS[estimate.plan.shapes.length % SHAPE_COLORS.length];
    const groupId = activeKit ? onApplyKit(activeKit) : null;
    onAddShape({ id: genId('shape'), type, groupId, vertices, measurement: 0, color });
    setActiveKitId(null);
    setActiveTool('select');
  }

  function handleSetScale(pixelsPerFoot, label) {
    onSetPlanScale({ pixelsPerFoot, p1: calPoints[0], p2: calPoints[1], label });
    setCalPoints([]);
    setActiveTool('select');
  }

  function handleResetScale() { onSetPlanScale(null); setCalPoints([]); setShowCalLine(false); }

  function handleAddPlant(partialPlant) {
    onAddPlant({ id: genId('plant'), ...partialPlant });
  }

  function handleAddItemPlacement(partialItem) {
    onAddItemPlacement({ id: genId('item-place'), ...partialItem });
  }

  // Toolbar icons
  const icons = {
    calibrate: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>,
    area: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 0 3 18L2 21z"/></svg>,
    linear: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20L20 4"/></svg>,
    select: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5"/></svg>,
    plant: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 22V12m0 0C12 7 7 4 3 6c4 1 7 4 9 6zm0 0c0-5 5-8 9-6-4 1-7 4-9 6"/></svg>,
    item: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>,
  };

  const toolHints = {
    area: 'Click to add vertices · Click first vertex or Enter to close',
    linear: 'Click to add vertices · Double-click or Enter to finish',
    calibrate: 'Click two points on a known distance',
    select: 'Select a shape, then drag its nodes to reshape · midpoint + adds a node · double-click a node to remove · Delete removes the shape',
    plant: plantable.length > 0
      ? 'Click to place · 1–' + plantable.length + ' or Tab to switch plant'
      : 'Assign plan symbols to plants in Catalog Settings first',
    item: itemable.length > 0
      ? 'Click to place · 1–' + itemable.length + ' or Tab to switch item'
      : 'Assign item symbols to catalog items in Catalog Settings first',
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Main toolbar */}
      <div className="flex items-center gap-1 px-4 py-2 bg-gray-900 shrink-0 border-b border-gray-700">
        <ToolBtn label="← Back" icon={null} active={false} onClick={onClose} />
        <div className="w-px h-5 bg-gray-700 mx-1" />
        <ToolBtn label="Calibrate" icon={icons.calibrate} active={activeTool === 'calibrate'} onClick={() => setActiveTool('calibrate')} />
        <ToolBtn label="Area"      icon={icons.area}      active={activeTool === 'area'}      onClick={() => setActiveTool('area')} />
        <ToolBtn label="Linear"    icon={icons.linear}    active={activeTool === 'linear'}    onClick={() => setActiveTool('linear')} />
        <ToolBtn label="Plant"     icon={icons.plant}     active={activeTool === 'plant'}     onClick={() => setActiveTool('plant')} />
        <ToolBtn label="Item"      icon={icons.item}      active={activeTool === 'item'}      onClick={() => setActiveTool('item')} />
        <ToolBtn label="Select"    icon={icons.select}    active={activeTool === 'select'}    onClick={() => setActiveTool('select')} />
        <div className="flex-1" />
        <button
          onClick={() => setShowMeasurements(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
            ${showMeasurements ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-700'}`}
          title={showMeasurements ? 'Hide takeoff numbers' : 'Show takeoff numbers'}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {showMeasurements
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
            }
          </svg>
          {showMeasurements ? '123' : '···'}
        </button>
        <span className="text-xs text-gray-500 hidden sm:block">{toolHints[activeTool]}</span>
      </div>

      {/* Area kit sub-toolbar */}
      {activeTool === 'area' && areaKits.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0 overflow-x-auto">
          <span className="text-xs text-gray-500 shrink-0 mr-1">Kit:</span>
          <button
            onClick={() => setActiveKitId(null)}
            className={`shrink-0 px-2.5 py-1 rounded text-xs font-medium transition-colors
              ${activeKitId === null ? 'bg-white text-gray-900' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
          >
            None
          </button>
          {areaKits.map(kit => (
            <button
              key={kit.id}
              onClick={() => setActiveKitId(activeKitId === kit.id ? null : kit.id)}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors
                ${activeKitId === kit.id ? 'bg-white text-gray-900' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: kit.color ?? '#059669' }} />
              {kit.name}
              <span className="opacity-40 text-[10px]">{kit.items.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Linear kit sub-toolbar */}
      {activeTool === 'linear' && linearKits.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0 overflow-x-auto">
          <span className="text-xs text-gray-500 shrink-0 mr-1">Kit:</span>
          <button
            onClick={() => setActiveKitId(null)}
            className={`shrink-0 px-2.5 py-1 rounded text-xs font-medium transition-colors
              ${activeKitId === null ? 'bg-white text-gray-900' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
          >
            None
          </button>
          {linearKits.map(kit => (
            <button
              key={kit.id}
              onClick={() => setActiveKitId(activeKitId === kit.id ? null : kit.id)}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors
                ${activeKitId === kit.id ? 'bg-white text-gray-900' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: kit.color ?? '#059669' }} />
              {kit.name}
              <span className="opacity-40 text-[10px]">{kit.items.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Plant sub-toolbar */}
      {activeTool === 'plant' && (
        <div className="flex items-center gap-1 px-4 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0">
          <span className="text-xs text-gray-500 mr-2">Plant:</span>
          {plantable.length === 0 ? (
            <span className="text-xs text-gray-500 italic">
              Open Catalog Settings → Plants and assign Plan Symbols
            </span>
          ) : (
            plantable.map((cat, i) => {
              const sym = PLANT_SYMBOL_MAP[cat.planSymbol];
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedPlantId(cat.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors
                    ${selectedPlantId === cat.id ? 'bg-white text-gray-900' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
                >
                  <span>{sym?.symbol ?? '🌱'}</span>
                  <span>{cat.name}</span>
                  <span className="opacity-40 text-[10px]">[{i + 1}]</span>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Item sub-toolbar */}
      {activeTool === 'item' && (
        <div className="flex items-center gap-1 px-4 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0">
          <span className="text-xs text-gray-500 mr-2">Item:</span>
          {itemable.length === 0 ? (
            <span className="text-xs text-gray-500 italic">
              Open Catalog Settings → assign Item Symbols to catalog items
            </span>
          ) : (
            itemable.map((cat, i) => {
              const sym = ITEM_TYPE_MAP[cat.itemSymbol];
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedItemCatalogId(cat.id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors
                    ${selectedItemCatalogId === cat.id ? 'bg-white text-gray-900' : 'text-gray-400 hover:bg-gray-700 hover:text-white'}`}
                >
                  <span>{sym?.symbol ?? '★'}</span>
                  <span>{cat.name}</span>
                  <span className="opacity-40 text-[10px]">[{i + 1}]</span>
                </button>
              );
            })
          )}
        </div>
      )}

      {placingPhoto && (
        <div className="flex items-center justify-center gap-3 bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
          <span>📍 Tap the plan to place the photo pin</span>
          {onCancelPlacePhoto && (
            <button onClick={onCancelPlacePhoto} className="rounded bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30">
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Delivery-loads column: trucks stacked into production days. */}
        <LoadsColumn loadBreakdown={loadBreakdown} />
        <PlanCanvas
          plan={estimate.plan}
          groups={groups}
          activeTool={activeTool}
          showCalLine={showCalLine}
          showMeasurements={showMeasurements}
          catalogPlants={catalogPlants}
          selectedPlantId={selectedPlantId}
          onPlantIdChange={setSelectedPlantId}
          onAddPlant={handleAddPlant}
          onRemovePlant={onRemovePlant}
          catalogItems={catalogItems}
          selectedItemCatalogId={selectedItemCatalogId}
          onItemCatalogIdChange={setSelectedItemCatalogId}
          onAddItemPlacement={handleAddItemPlacement}
          onRemoveItemPlacement={onRemoveItemPlacement}
          onCalibrationPointsSet={handleCalibrationPointsSet}
          onShapeComplete={handleShapeComplete}
          onUpdateShape={onUpdateShape}
          onRemoveShape={onRemoveShape}
          photoPins={photoPins}
          placingPhoto={placingPhoto}
          onPlacePhotoPin={onPlacePhotoPin}
          onOpenPhotoPin={onOpenPhotoPin}
        />
        <PlanShapeList
          plan={estimate.plan}
          groups={groups}
          catalogPlants={catalogPlants}
          catalogItems={catalogItems}
          calPending={calPending}
          calPoints={calPoints}
          onSetPlanImage={onSetPlanImage}
          onSetScale={handleSetScale}
          onResetScale={handleResetScale}
          showCalLine={showCalLine}
          onToggleCalLine={() => setShowCalLine(v => !v)}
          onUpdateShape={onUpdateShape}
          onRemoveShape={onRemoveShape}
          onAddGroup={onAddGroup}
          kits={kits}
          onApplyKit={onApplyKit}
        />
      </div>
    </div>
  );
}

const TRUCKS_PER_DAY_STORE = 'plan_trucks_per_day';

// Delivery loads laid out as a production schedule: every truckload the take-off
// needs becomes one truck icon, packed N-per-row where N is the daily
// mobilization (1/2/3 trucks going to site per day). Each row is one production
// day, so the row count is the number of production days. Trucks stay grouped by
// material and keep the material's icon. Everything recomputes live as take-off
// quantities change.
function LoadsColumn({ loadBreakdown }) {
  const [trucksPerRow, setTrucksPerRow] = useState(() => {
    if (typeof window === 'undefined') return 2;
    const v = parseInt(localStorage.getItem(TRUCKS_PER_DAY_STORE), 10);
    return v === 1 || v === 2 || v === 3 ? v : 2;
  });
  function pick(n) {
    setTrucksPerRow(n);
    if (typeof window !== 'undefined') localStorage.setItem(TRUCKS_PER_DAY_STORE, String(n));
  }

  // Flatten to one entry per truckload, preserving material identity/order.
  const trucks = [];
  for (const g of loadBreakdown) {
    const icon = loadIcon(g.category, g.name);
    for (let i = 0; i < g.loads; i++) trucks.push({ icon, name: g.name });
  }
  const totalLoads = trucks.length;
  const rows = [];
  for (let i = 0; i < trucks.length; i += trucksPerRow) rows.push(trucks.slice(i, i + trucksPerRow));
  const productionDays = rows.length;

  return (
    <div className="flex w-40 shrink-0 flex-col border-r border-gray-700 bg-gray-900">
      {/* Header + trucks-per-day (mobilization) selector */}
      <div className="shrink-0 border-b border-gray-700 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Loads</span>
          <span className="rounded bg-gray-700 px-1.5 py-0.5 text-xs font-semibold text-gray-100">{totalLoads}</span>
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-wide text-gray-500">Trucks / day</div>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              onClick={() => pick(n)}
              className={`flex-1 rounded py-1 text-xs font-semibold transition-colors ${
                trucksPerRow === n ? 'bg-white text-gray-900' : 'text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {totalLoads > 0 && (
          <div className="mt-2 text-[10px] leading-tight text-gray-500">
            {productionDays} production day{productionDays === 1 ? '' : 's'} · {trucksPerRow}/day
          </div>
        )}
      </div>

      {/* Production-day rows */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {totalLoads === 0 ? (
          <p className="px-1 text-[11px] leading-snug text-gray-500">
            No delivery loads yet — plot take-off areas for bulk materials to see loads here.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {rows.map((row, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 rounded bg-gray-800/60 px-1.5 py-1"
                title={`Production day ${idx + 1}: ${row.map((t) => t.name).join(', ')}`}
              >
                <span className="w-5 shrink-0 text-right text-[10px] font-semibold text-gray-500">{idx + 1}</span>
                <div className="flex flex-wrap items-center gap-0.5">
                  {row.map((t, i) => (
                    <span key={i} className="text-xl leading-none">{t.icon}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend: which glyph is which material, with load counts. */}
      {totalLoads > 0 && (
        <div className="shrink-0 border-t border-gray-700 px-2 py-2">
          <div className="flex flex-col gap-1">
            {loadBreakdown.map((g) => (
              <div key={g.key} className="flex items-center gap-1.5 text-[11px] text-gray-300" title={g.name}>
                <span className="shrink-0 text-base leading-none">{loadIcon(g.category, g.name)}</span>
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className="shrink-0 font-semibold text-gray-400">{g.loads}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
