import { useRef, useState } from 'react';
import { PLANT_TYPES, ITEM_TYPES } from './PlanCanvas';

const PLANT_SYMBOL_MAP = Object.fromEntries(PLANT_TYPES.map(pt => [pt.key, pt]));
const ITEM_SYMBOL_MAP = Object.fromEntries(ITEM_TYPES.map(it => [it.key, it]));

function ShapeItem({ shape, availableGroups, kits, onUpdate, onRemove, onAddGroup, onApplyKit }) {
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [kitPicking, setKitPicking] = useState(false);

  function handleSelectChange(e) {
    if (e.target.value === '__new__') {
      setNaming(true);
      setNewName('');
    } else if (e.target.value === '__kit__') {
      setKitPicking(true);
    } else {
      onUpdate(shape.id, { groupId: e.target.value || null });
    }
  }

  function handleConfirmNew() {
    const name = newName.trim() || 'New Take Off';
    const groupId = onAddGroup(name);
    onUpdate(shape.id, { groupId });
    setNaming(false);
  }

  function handleKitSelect(kit) {
    const groupId = onApplyKit(kit);
    onUpdate(shape.id, { groupId });
    setKitPicking(false);
  }

  const header = (
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: shape.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-700 truncate">
          {shape.type === 'area'
            ? `${Math.round(shape.measurement).toLocaleString()} sq ft`
            : `${Math.round(shape.measurement).toLocaleString()} ln ft`}
        </p>
        <p className="text-[10px] text-gray-400">{shape.type === 'area' ? 'Area' : 'Linear'}</p>
      </div>
      <button
        onClick={() => onRemove(shape.id)}
        className="shrink-0 p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
        title="Remove shape"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  if (naming) {
    return (
      <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-2 flex flex-col gap-1.5">
        {header}
        <input
          autoFocus
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleConfirmNew(); if (e.key === 'Escape') setNaming(false); }}
          placeholder="Group name…"
          className="w-full text-xs border border-indigo-300 rounded px-1.5 py-1 bg-white text-gray-800
                     focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <div className="flex gap-1">
          <button
            onClick={handleConfirmNew}
            className="flex-1 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium transition-colors"
          >
            Create
          </button>
          <button
            onClick={() => setNaming(false)}
            className="flex-1 py-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (kitPicking) {
    return (
      <div className="rounded-lg border border-green-600 bg-gray-800 p-2 flex flex-col gap-1.5">
        {header}
        <p className="text-[10px] text-green-400 font-semibold uppercase tracking-wide">Select a kit:</p>
        <div className="flex flex-col gap-1">
          {kits.map(kit => (
            <button
              key={kit.id}
              onClick={() => handleKitSelect(kit)}
              className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded bg-gray-700
                         hover:bg-green-700 transition-colors text-xs text-gray-200 hover:text-white"
            >
              <svg className="w-3.5 h-3.5 text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              <span className="flex-1 truncate font-medium">{kit.name}</span>
              <span className="text-[10px] text-gray-400 shrink-0">{kit.items.length} items</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setKitPicking(false)}
          className="w-full py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 flex flex-col gap-1.5">
      {header}
      <select
        value={shape.groupId || ''}
        onChange={handleSelectChange}
        className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-700
                   focus:outline-none focus:ring-1 focus:ring-indigo-400"
      >
        <option value="">Unlinked</option>
        {availableGroups.map(g => (
          <option key={g.id} value={g.id}>{g.label}</option>
        ))}
        <option value="__new__">＋ New group…</option>
        {kits?.length > 0 && <option value="__kit__">🔖 From kit…</option>}
      </select>
    </div>
  );
}

export default function PlanShapeList({
  plan, groups, catalogPlants, catalogItems, calPending, calPoints,
  onSetPlanImage, onSetScale, onResetScale,
  onUpdateShape, onRemoveShape, onAddGroup,
  showCalLine, onToggleCalLine,
  kits, onApplyKit,
}) {
  const fileInputRef = useRef(null);
  const [calDistance, setCalDistance] = useState('');

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        onSetPlanImage({ imageDataUrl: ev.target.result, imageWidth: img.naturalWidth, imageHeight: img.naturalHeight });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function handleSetScale() {
    const distance = parseFloat(calDistance);
    if (!distance || distance <= 0 || !calPoints[0] || !calPoints[1]) return;
    const dx = calPoints[1].x - calPoints[0].x;
    const dy = calPoints[1].y - calPoints[0].y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    onSetScale(pixelDist / distance, `${distance} ft`);
    setCalDistance('');
  }

  return (
    <div className="w-60 shrink-0 border-l border-gray-700 overflow-y-auto bg-gray-900 flex flex-col text-white">

      {/* Image upload */}
      {!plan.imageDataUrl && (
        <div className="p-3 border-b border-gray-700">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium transition-colors"
          >
            Upload Plan Image
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>
      )}

      {/* Scale status */}
      <div className="p-3 border-b border-gray-700">
        {plan.scale ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-300">
              1 ft = {plan.scale.pixelsPerFoot.toFixed(1)} px
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onToggleCalLine}
                className={`text-xs transition-colors ${showCalLine ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-500 hover:text-gray-300'}`}
                title={showCalLine ? 'Hide calibration line' : 'Show calibration line'}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {showCalLine
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  }
                </svg>
              </button>
              <button
                onClick={onResetScale}
                className="text-xs text-red-400 hover:text-red-300 underline"
              >
                Reset
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500">No scale set — use Calibrate tool</p>
        )}
      </div>

      {/* Calibration distance input */}
      {calPending && (
        <div className="p-3 border-b border-gray-700 bg-yellow-900/30">
          <p className="text-xs font-semibold text-yellow-300 mb-2">Enter distance between points:</p>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={calDistance}
              onChange={e => setCalDistance(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSetScale()}
              placeholder="e.g. 20"
              autoFocus
              className="flex-1 min-w-0 border border-gray-600 rounded px-2 py-1 text-sm bg-gray-800
                         text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
            <span className="text-xs text-gray-400 shrink-0">ft</span>
          </div>
          <button
            onClick={handleSetScale}
            className="mt-2 w-full py-1.5 bg-yellow-500 hover:bg-yellow-400 text-white rounded text-sm font-medium transition-colors"
          >
            Set Scale
          </button>
        </div>
      )}

      {/* Plant count summary */}
      {(plan.plants ?? []).length > 0 && (
        <div className="px-3 py-2 border-b border-gray-700">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Plants</p>
          <div className="flex flex-col gap-1">
            {(catalogPlants ?? []).map(cat => {
              const count = (plan.plants ?? []).filter(p => p.catalogId === cat.id).length;
              if (!count) return null;
              const sym = PLANT_SYMBOL_MAP[cat.planSymbol];
              return (
                <div key={cat.id} className="flex items-center justify-between">
                  <span className="text-xs text-gray-300">{sym?.symbol ?? '🌱'} {cat.name}</span>
                  <span className="text-xs font-bold text-white bg-gray-700 px-1.5 py-0.5 rounded-full min-w-[1.4rem] text-center">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Item placement count summary */}
      {(plan.items ?? []).length > 0 && (
        <div className="px-3 py-2 border-b border-gray-700">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Items</p>
          <div className="flex flex-col gap-1">
            {(catalogItems ?? []).map(cat => {
              const count = (plan.items ?? []).filter(p => p.catalogId === cat.id).length;
              if (!count) return null;
              const sym = ITEM_SYMBOL_MAP[cat.itemSymbol];
              return (
                <div key={cat.id} className="flex items-center justify-between">
                  <span className="text-xs text-gray-300">{sym?.symbol ?? '★'} {cat.name}</span>
                  <span className="text-xs font-bold text-white bg-gray-700 px-1.5 py-0.5 rounded-full min-w-[1.4rem] text-center">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Shape list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {plan.imageDataUrl && plan.shapes.length === 0 && (
          <p className="text-xs text-gray-500 text-center mt-4 leading-relaxed">
            No shapes yet.<br />Use Area or Linear tools.
          </p>
        )}
        {plan.shapes.map(shape => {
          // Only show groups not already linked to another shape of the same type
          const availableGroups = groups.filter(g =>
            g.id === shape.groupId ||
            !plan.shapes.some(s => s.id !== shape.id && s.groupId === g.id && s.type === shape.type)
          );
          return (
            <ShapeItem
              key={shape.id}
              shape={shape}
              availableGroups={availableGroups}
              kits={kits}
              onUpdate={onUpdateShape}
              onRemove={onRemoveShape}
              onAddGroup={onAddGroup}
              onApplyKit={onApplyKit}
            />
          );
        })}
      </div>

      {/* Change image (when image exists) */}
      {plan.imageDataUrl && (
        <div className="p-2 border-t border-gray-700">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
          >
            Replace Image
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>
      )}
    </div>
  );
}
