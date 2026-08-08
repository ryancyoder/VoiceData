import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CATEGORY_COLORS } from '@/lib/estimator/catalog';
import { isGroupInherited } from '@/lib/estimator/useEstimate';

function fmt(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function EstimateRow({ item, isGrouped = false, onUpdate, onUpdateTakeoff, onUpdateWallDimensions, onRemove }) {
  const [notesOpen, setNotesOpen] = useState(!!item.notes);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };

  const colors = CATEGORY_COLORS[item.category];
  const inherited = isGrouped && isGroupInherited(item);

  // Line total calculation (material cost only; delivery is summed separately in summary)
  let lineTotal = 0;
  if (item.isWallAssembly) {
    lineTotal = (item.faceFt * item.pricePerFaceFt) + (item.linearFt * item.pricePerLinearFt);
  } else {
    lineTotal = item.quantity * item.unitPrice;
  }

  const loads = (!item.isWallAssembly && item.unitsPerLoad && item.quantity > 0)
    ? Math.ceil(item.quantity / item.unitsPerLoad) : 0;
  const hasNotes = !!item.notes;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        group rounded-lg border bg-white
        ${isDragging ? 'shadow-xl border-blue-300' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'}
        transition-all duration-100
      `}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2">

        {/* Drag handle */}
        <button
          {...listeners}
          {...attributes}
          style={{ touchAction: 'none' }}
          className="cursor-grab active:cursor-grabbing p-1 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors shrink-0 print:hidden"
          tabIndex={-1}
          title="Drag to reorder"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
          </svg>
        </button>

        {/* Category dot — same width as group collapse button for column alignment */}
        <span className="shrink-0 w-6 flex items-center justify-center">
          <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
        </span>

        {/* ── WALL ASSEMBLY ── */}
        {item.isWallAssembly ? (
          <>
            {/* LF × Height inputs (or read-only if inherited from group) */}
            <div className="flex items-start gap-1.5 shrink-0">
              <div className="w-20">
                {inherited ? (
                  <>
                    <div className="text-sm text-center border border-indigo-200 rounded px-2 py-1 bg-indigo-50 text-indigo-700">
                      {Math.round(item.linearFt)}
                    </div>
                    <p className="text-xs text-center text-indigo-400 mt-0.5">ln ft ↑</p>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={item.linearFt}
                      onChange={e => onUpdateWallDimensions(item.id, parseFloat(e.target.value) || 0, item.height)}
                      className="w-full text-sm text-center border border-stone-200 rounded px-2 py-1
                                 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent"
                      title="Linear feet"
                    />
                    <p className="text-xs text-center text-gray-400 mt-0.5">ln ft</p>
                  </>
                )}
              </div>
              <span className="text-gray-400 text-sm mt-1.5">×</span>
              <div className="w-16">
                {inherited ? (
                  <>
                    <div className="text-sm text-center border border-indigo-200 rounded px-2 py-1 bg-indigo-50 text-indigo-700">
                      {Math.round(item.height * 10) / 10}
                    </div>
                    <p className="text-xs text-center text-indigo-400 mt-0.5">height ↑</p>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={item.height}
                      onChange={e => onUpdateWallDimensions(item.id, item.linearFt, parseFloat(e.target.value) || 0)}
                      className="w-full text-sm text-center border border-stone-200 rounded px-2 py-1
                                 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-transparent"
                      title="Wall height (ft)"
                    />
                    <p className="text-xs text-center text-gray-400 mt-0.5">height</p>
                  </>
                )}
              </div>
              <div className="text-right pt-1 w-20">
                <p className="text-xs font-medium text-gray-700">{fmt(item.faceFt)}</p>
                <p className="text-xs text-gray-400">face ft</p>
              </div>
            </div>

            {/* Name */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
              <p className="text-xs text-gray-400">{item.category}</p>
            </div>

            {/* Dual price display */}
            <div className="w-28 text-right shrink-0">
              <p className="text-xs text-gray-500">${fmt(item.pricePerFaceFt)}<span className="text-gray-400">/ff</span></p>
              <p className="text-xs text-gray-500">${fmt(item.pricePerLinearFt)}<span className="text-gray-400">/lf</span></p>
            </div>
          </>
        ) : (
          <>
            {/* ── STANDARD / ASSEMBLY — qty field aligns with group DimInput ── */}
            {item.isAssembly ? (
              <div className="w-20 shrink-0">
                {inherited ? (
                  <div className="text-sm text-center border border-indigo-200 rounded px-2 py-1 bg-indigo-50 text-indigo-700">
                    {Math.round(item.takeoffQty)}
                  </div>
                ) : (
                  <input
                    type="number"
                    min="0"
                    step={item.unitsPerLoad ? item.coverageRate * item.unitsPerLoad : 'any'}
                    value={item.takeoffQty}
                    onChange={e => onUpdateTakeoff(item.id, parseFloat(e.target.value) || 0)}
                    className="w-full text-sm text-center border border-amber-200 rounded px-2 py-1
                               focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                    title={item.unitsPerLoad ? `1 load = ${item.coverageRate * item.unitsPerLoad} ${item.takeoffUnit}` : `Takeoff in ${item.takeoffUnit}`}
                  />
                )}
                <p className="text-xs text-center text-gray-400 mt-0.5">
                  {item.takeoffUnit} → {item.quantity.toFixed(2)} {item.unit}
                </p>
                {loads > 0 && (
                  <p className="text-xs text-center text-blue-500 mt-0.5">
                    {loads} load{loads !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            ) : (
              <div className="w-20 shrink-0">
                {(item.isPlantItem || item.isItemPlacement) ? (
                  <>
                    <div className="text-sm text-center border border-indigo-200 rounded px-2 py-1 bg-indigo-50 text-indigo-700 flex items-center justify-center gap-0.5" title="Controlled by plan">
                      <span>{item.quantity}</span><span className="text-xs">🗺</span>
                    </div>
                    <p className="text-xs text-center text-indigo-400 mt-0.5">from plan</p>
                  </>
                ) : inherited ? (
                  <>
                    <div className="text-sm text-center border border-indigo-200 rounded px-2 py-1 bg-indigo-50 text-indigo-700">
                      {Math.round(item.quantity)}
                    </div>
                    <p className="text-xs text-center text-indigo-400 mt-0.5">{item.unit} ↑</p>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={item.quantity}
                      onChange={e => onUpdate(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-full text-sm text-center border border-gray-200 rounded px-2 py-1
                                 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                      title="Quantity"
                    />
                    <p className="text-xs text-center text-gray-400 mt-0.5">{item.unit}</p>
                  </>
                )}
              </div>
            )}

            {/* Name */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
              <p className="text-xs text-gray-400">{item.category}</p>
            </div>

            {/* Unit price (read-only — comes from catalog) */}
            <div className="w-24 text-right shrink-0">
              <span className="text-sm text-gray-600">${fmt(item.unitPrice)}</span>
            </div>
          </>
        )}

        {/* Line total */}
        <div className="w-24 text-right shrink-0">
          <span className="text-sm font-semibold text-gray-800">${fmt(lineTotal)}</span>
          {item.isWallAssembly && item.faceFt > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {fmt(item.faceFt)} ff
            </p>
          )}
        </div>

        {/* Notes toggle */}
        <button
          onClick={() => setNotesOpen(o => !o)}
          className={`shrink-0 p-1 rounded transition-colors print:hidden
            ${hasNotes
              ? 'text-yellow-500 hover:bg-yellow-50'
              : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
            }`}
          title={notesOpen ? 'Hide notes' : 'Add notes'}
        >
          <svg className="w-4 h-4" fill={hasNotes ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 8h10M7 12h6m-6 4h4M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
          </svg>
        </button>

        {/* Delete */}
        <button
          onClick={() => onRemove(item.id)}
          className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50
                     transition-colors opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 print:hidden"
          title="Remove item"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Notes row */}
      {notesOpen && (
        <div className="px-3 pb-2 pl-10">
          <textarea
            rows={2}
            placeholder="Job-specific notes for this item…"
            value={item.notes}
            onChange={e => onUpdate(item.id, 'notes', e.target.value)}
            className="w-full text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-2 resize-none
                       focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent
                       placeholder:text-gray-300"
          />
        </div>
      )}

      {/* Notes print-only */}
      {hasNotes && (
        <div className="hidden print:block px-3 pb-2 pl-10 text-xs text-gray-500 italic">
          {item.notes}
        </div>
      )}
    </div>
  );
}
