import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS } from '@/lib/estimator/catalog';
import { SHAPE_COLORS } from '@/lib/estimator/useEstimate';
import CatalogCard from './CatalogCard';

function TakeOffGroupCard() {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: 'catalog-takeoff-group',
    data: { type: 'takeoff-group' },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ touchAction: 'none' }}
      className={`
        flex items-center gap-2.5 px-3 py-2 rounded-lg border border-dashed border-indigo-300
        bg-indigo-50 cursor-grab active:cursor-grabbing hover:bg-indigo-100 transition-colors
        ${isDragging ? 'opacity-40' : ''}
      `}
    >
      <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-indigo-700">Take Off Group</p>
        <p className="text-xs text-indigo-400">Drag to create a group</p>
      </div>
    </div>
  );
}

const UNIT_CYCLE = [null, 'area', 'linear'];
const UNIT_LABELS = { null: 'Any', area: 'Area', linear: 'Linear' };

function AssemblyKitCard({ kit, onRemove, onUpdate }) {
  const [showColors, setShowColors] = useState(false);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `kit-drag-${kit.id}`,
    data: { type: 'assembly-kit', kit },
  });

  function cycleUnit(e) {
    e.stopPropagation();
    const idx = UNIT_CYCLE.indexOf(kit.takeoffUnit ?? null);
    const next = UNIT_CYCLE[(idx + 1) % UNIT_CYCLE.length];
    onUpdate(kit.id, { takeoffUnit: next });
  }

  const dotColor = kit.color ?? '#059669';

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        style={{ touchAction: 'none' }}
        className={`
          flex items-center gap-2 px-2.5 py-2 rounded-lg border border-green-200
          bg-green-50 cursor-grab active:cursor-grabbing hover:bg-green-100 transition-colors group
          ${isDragging ? 'opacity-40' : ''}
        `}
      >
        {/* Color swatch — stops drag, toggles color picker */}
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); setShowColors(v => !v); }}
          className="w-4 h-4 rounded-full shrink-0 border-2 border-white ring-1 ring-gray-300 hover:ring-gray-500 transition-all"
          style={{ backgroundColor: dotColor }}
          title="Change color"
        />

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-green-800 truncate">{kit.name}</p>
          {kit.description && (
            <p className="text-[10px] text-green-600 truncate">{kit.description}</p>
          )}
        </div>

        {/* Unit badge */}
        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={cycleUnit}
          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors
            bg-green-200 text-green-700 hover:bg-indigo-200 hover:text-indigo-700"
          title="Click to cycle takeoff type"
        >
          {UNIT_LABELS[kit.takeoffUnit ?? null]}
        </button>

        <span className="text-xs bg-green-200 text-green-700 px-1.5 py-0.5 rounded-full shrink-0 font-medium">
          {kit.items.length}
        </span>

        <button
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onRemove(kit.id); }}
          className="shrink-0 p-0.5 rounded text-green-300 hover:text-red-500 hover:bg-red-50
                     opacity-0 group-hover:opacity-100 transition-all"
          title="Remove kit"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Inline color picker */}
      {showColors && (
        <div className="flex gap-1.5 flex-wrap px-1 pb-1">
          {SHAPE_COLORS.map(c => (
            <button
              key={c}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onUpdate(kit.id, { color: c }); setShowColors(false); }}
              className={`w-5 h-5 rounded-full border-2 transition-all hover:scale-110
                ${(kit.color ?? null) === c ? 'border-gray-700 scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CatalogPanel({ catalogItems, kits = [], onRemoveKit, onUpdateKit }) {
  const [activeCategory, setActiveCategory] = useState('plants');
  const [kitsExpanded, setKitsExpanded] = useState(true);

  const visibleItems = catalogItems.filter(item => item.category === activeCategory);

  return (
    <aside className="w-72 shrink-0 flex flex-col bg-white border-r border-gray-200 h-full overflow-hidden print:hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          Catalog
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">Drag items onto the estimate</p>
      </div>

      {/* Take Off Group card */}
      <div className="px-3 py-2 border-b border-gray-100">
        <TakeOffGroupCard />
      </div>

      {/* Assembly Kits section */}
      <div className="border-b border-gray-100">
        <button
          onClick={() => setKitsExpanded(o => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
        >
          <svg
            className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${kitsExpanded ? '' : '-rotate-90'}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex-1">
            Assembly Kits
          </span>
          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">
            {kits.length}
          </span>
        </button>

        {kitsExpanded && (
          <div className="px-3 pb-2 flex flex-col gap-1.5">
            {kits.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-1 px-1">
                No kits saved yet. Use the bookmark icon on a take off group to save one.
              </p>
            ) : (
              kits.map(kit => (
                <AssemblyKitCard key={kit.id} kit={kit} onRemove={onRemoveKit} onUpdate={onUpdateKit} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex flex-col gap-1 px-3 py-2 border-b border-gray-100">
        {CATEGORIES.map(cat => {
          const colors = CATEGORY_COLORS[cat];
          const isActive = activeCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
                text-left transition-colors duration-100
                ${isActive
                  ? `${colors.bg} ${colors.text}`
                  : 'text-gray-600 hover:bg-gray-100'
                }
              `}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? colors.dot : 'bg-gray-300'}`} />
              {CATEGORY_LABELS[cat]}
              <span className={`ml-auto text-xs px-1.5 py-0.5 rounded-full ${isActive ? colors.badge : 'bg-gray-100 text-gray-500'}`}>
                {catalogItems.filter(i => i.category === cat).length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Item cards */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2">
        {visibleItems.map(item => (
          <CatalogCard key={item.id} item={item} />
        ))}
      </div>
    </aside>
  );
}
