import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function itemLineTotal(item) {
  if (item.isWallAssembly) {
    return (item.faceFt * item.pricePerFaceFt) + (item.linearFt * item.pricePerLinearFt);
  }
  return item.quantity * item.unitPrice;
}

function fmt(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function DimInput({ label, value, onChange, step = 'any', readOnly = false }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-xs text-indigo-400 font-medium uppercase tracking-wide">{label}</span>
      {readOnly ? (
        <div
          className="w-20 text-sm text-center border border-indigo-200 rounded px-2 py-1
                     bg-indigo-50 text-indigo-700 font-semibold flex items-center justify-center gap-0.5"
          title="Controlled by plan"
        >
          <span>{value.toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
          <span className="text-xs">🗺</span>
        </div>
      ) : (
        <input
          type="number"
          min="0"
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="w-20 text-sm text-center border border-indigo-200 rounded px-2 py-1
                     bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
        />
      )}
    </div>
  );
}

export default function TakeOffGroupRow({ group, onUpdate, onToggleCollapse, onRemove, onSaveAsKit, isActive, onSetActive, hasMapLink, children }) {
  const [notesOpen, setNotesOpen] = useState(!!group.notes);
  const hasNotes = !!group.notes;
  const faceFt = group.linearFt * group.height;
  const groupTotal = group.items.reduce((sum, item) => sum + itemLineTotal(item), 0);

  // Derive which dimension inputs are relevant from the items in this group.
  // Always show a dimension if its value is non-zero (user set it manually).
  const needsSqFt = group.items.some(i =>
    (i.isAssembly && (!i.takeoffUnit || i.takeoffUnit === 'sq ft')) ||
    (!i.isAssembly && !i.isWallAssembly && i.unit === 'sq ft')
  );
  const needsLinFt = group.items.some(i =>
    (i.isAssembly && i.takeoffUnit === 'ln ft') ||
    i.isWallAssembly ||
    (!i.isAssembly && !i.isWallAssembly && i.unit === 'ln ft')
  );
  const needsHeight = group.items.some(i => i.isWallAssembly);

  // Show sq ft if items need it, or if it's non-zero, or if nothing else is needed (default for empty groups)
  const showSqFt  = needsSqFt  || group.sqFt > 0     || (!needsLinFt && !needsHeight);
  const showLinFt = needsLinFt || group.linearFt > 0;
  const showHeight = needsHeight || group.height > 0;
  const showFaceFt = showHeight;

  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id });

  // Make the group header a drop target for catalog items
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: group.id });

  function setRef(el) {
    setSortableRef(el);
    setDropRef(el);
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setRef} style={style} className={`rounded-xl overflow-hidden border shadow-sm transition-all ${isActive ? 'border-green-400 ring-2 ring-green-300' : 'border-indigo-200'}`}>
      {/* Group header */}
      <div
        className={`flex items-center gap-3 px-3 py-2.5 transition-colors cursor-pointer
          ${isOver ? 'bg-indigo-100' : isActive ? 'bg-green-50' : 'bg-indigo-50'}
        `}
        onClick={e => {
          if (!['BUTTON', 'INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
            onSetActive?.(group.id);
          }
        }}
      >
        {/* Drag handle */}
        <button
          {...listeners}
          {...attributes}
          style={{ touchAction: 'none' }}
          className="cursor-grab active:cursor-grabbing p-1 rounded text-indigo-300 hover:text-indigo-500 hover:bg-indigo-100 transition-colors shrink-0 print:hidden"
          tabIndex={-1}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
          </svg>
        </button>

        {/* Collapse toggle */}
        <button
          onClick={() => onToggleCollapse(group.id)}
          className="shrink-0 p-1 rounded text-indigo-500 hover:bg-indigo-100 transition-colors print:hidden"
          title={group.collapsed ? 'Expand' : 'Collapse'}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-150 ${group.collapsed ? '-rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dimension inputs — only show what items in this group actually need */}
        {!group.isPlantsGroup && !group.isItemsGroup && (
          <div className="flex items-end gap-3 shrink-0 print:hidden">
            {showSqFt  && <DimInput label="Sq Ft"  value={group.sqFt}      onChange={v => onUpdate(group.id, 'sqFt', v)}      readOnly={hasMapLink} />}
            {showLinFt && <DimInput label="Lin Ft" value={group.linearFt}  onChange={v => onUpdate(group.id, 'linearFt', v)}  readOnly={hasMapLink} />}
            {showHeight && <DimInput label="Height" value={group.height}   onChange={v => onUpdate(group.id, 'height', v)}    step="0.5" />}
            {showFaceFt && (
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-xs text-indigo-400 font-medium uppercase tracking-wide">Face Ft</span>
                <div className="w-20 text-sm text-center bg-indigo-100 text-indigo-700 font-semibold rounded px-2 py-1">
                  {faceFt.toLocaleString('en-US', { maximumFractionDigits: 1 })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Label */}
        <input
          type="text"
          value={group.label}
          onChange={e => onUpdate(group.id, 'label', e.target.value)}
          placeholder="Take Off Label"
          data-group-label={group.id}
          className="flex-1 text-sm font-semibold text-indigo-800 bg-transparent border-b border-indigo-200
                     focus:outline-none focus:border-indigo-500 placeholder:text-indigo-300 min-w-0"
        />

        {/* Print-only dimension summary */}
        {!group.isPlantsGroup && !group.isItemsGroup && (
          <div className="hidden print:flex items-center gap-4 text-xs text-indigo-600 shrink-0">
            {group.sqFt > 0 && <span>{group.sqFt} sq ft</span>}
            {group.linearFt > 0 && <span>{group.linearFt} ln ft</span>}
            {faceFt > 0 && <span>{faceFt.toLocaleString()} face ft</span>}
          </div>
        )}

        {/* Active indicator */}
        {isActive && !isOver && (
          <span className="text-xs text-green-600 font-medium shrink-0 print:hidden">
            ● active
          </span>
        )}

        {/* Drop hint */}
        {isOver && (
          <span className="text-xs text-indigo-500 font-medium animate-pulse shrink-0 print:hidden">
            Drop to add to group
          </span>
        )}

        {/* Item count badge */}
        <span className="text-xs bg-indigo-200 text-indigo-700 px-2 py-0.5 rounded-full shrink-0 font-medium print:hidden">
          {group.items.length}
        </span>

        {/* Save as Kit — before total columns so trailing button count matches item rows */}
        {!group.isPlantsGroup && !group.isItemsGroup && onSaveAsKit && (
          <button
            onClick={() => onSaveAsKit(group.id)}
            className="shrink-0 p-1 rounded text-green-600 hover:text-green-700 hover:bg-green-100 transition-colors print:hidden"
            title="Save as assembly kit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
        )}

        {/* $/Unit spacer — keeps total aligned with item rows */}
        <div className="w-24 shrink-0 print:hidden" />

        {/* Group total — w-24 matches item Total column */}
        <div className="shrink-0 w-24 text-right">
          <p className="text-sm font-bold text-indigo-800">${fmt(groupTotal)}</p>
          <p className="text-xs text-indigo-400 print:hidden">group total</p>
        </div>

        {/* Notes toggle */}
        <button
          onClick={() => setNotesOpen(o => !o)}
          className={`shrink-0 p-1 rounded transition-colors print:hidden
            ${hasNotes ? 'text-yellow-500 hover:bg-yellow-50' : 'text-indigo-300 hover:text-indigo-500 hover:bg-indigo-100'}`}
          title={notesOpen ? 'Hide notes' : 'Add notes'}
        >
          <svg className="w-4 h-4" fill={hasNotes ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 8h10M7 12h6m-6 4h4M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
          </svg>
        </button>

        {/* Delete group */}
        <button
          onClick={() => onRemove(group.id)}
          className="shrink-0 p-1 rounded text-indigo-300 hover:text-red-500 hover:bg-red-50 transition-colors [@media(hover:none)]:opacity-100 print:hidden"
          title="Remove group and all its items"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Group notes */}
      {notesOpen && (
        <div className="px-3 py-2 bg-yellow-50 border-t border-yellow-100 print:hidden">
          <textarea
            rows={2}
            placeholder="Notes for this take off group…"
            value={group.notes}
            onChange={e => onUpdate(group.id, 'notes', e.target.value)}
            className="w-full text-xs text-gray-700 border border-yellow-200 rounded-lg px-3 py-2 resize-none
                       bg-white focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent
                       placeholder:text-gray-300"
          />
        </div>
      )}
      {hasNotes && (
        <div className="hidden print:block px-4 py-1.5 bg-yellow-50 border-t border-yellow-100 text-xs text-gray-500 italic">
          {group.notes}
        </div>
      )}

      {/* Grouped items */}
      {!group.collapsed && (
        <div className="border-t border-indigo-100 bg-white">
          {children}
          {group.items.length === 0 && (
            <div className="flex items-center justify-center py-4 text-sm text-indigo-300 italic">
              Drag catalog items here to add to this group
            </div>
          )}
        </div>
      )}
    </div>
  );
}
