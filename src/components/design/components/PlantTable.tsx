import { useState, useCallback } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useCustomStampStore, usePlanSymbolStore } from '../store/useCustomStampStore';
import { useProjectStore } from '../store/useProjectStore';
import { getSubcategoryLabel, getSubcategoriesForTopLevel, TOP_LEVEL_CATEGORIES } from '../engine/categoryGroups';
import type { CustomStamp, PlantMeta } from '../types';

export function PlantTable({ onClose }: { onClose: () => void }) {
  const viewMode = useProjectStore((s) => s.viewMode);
  const customSubcategories = useProjectStore((s) => s.customSubcategories);

  const perspStamps = useCustomStampStore((s) => s.stamps);
  const planSymbols = usePlanSymbolStore((s) => s.symbols);
  const updateStampMeta = useCustomStampStore((s) => s.updateStampMeta);
  const updateSymbolMeta = usePlanSymbolStore((s) => s.updateSymbolMeta);
  const removeStamp = useCustomStampStore((s) => s.removeStamp);
  const removeSymbol = usePlanSymbolStore((s) => s.removeSymbol);

  const isPlan = viewMode === 'plan';
  const items = isPlan ? planSymbols : perspStamps;
  const doUpdate = isPlan ? updateSymbolMeta : updateStampMeta;
  const doRemove = isPlan ? removeSymbol : removeStamp;

  // Exclude textures from the table — those aren't plants
  const plants = items.filter((s) => s.category !== 'textures' && !s.name.startsWith('tex-'));

  // Build flat list of all subcategories for the category dropdown
  const allSubcategories: { id: string; label: string }[] = [];
  for (const top of TOP_LEVEL_CATEGORIES) {
    const subs = getSubcategoriesForTopLevel(top.id, customSubcategories);
    for (const sub of subs) {
      if (sub === 'textures') continue;
      allSubcategories.push({ id: sub, label: getSubcategoryLabel(sub, customSubcategories) });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-[95vw] max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">
            {isPlan ? '2D Symbol' : 'Plant'} Database ({plants.length})
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"
          >
            <X size={20} />
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="w-14 px-2 py-2"></th>
                <th className="text-left px-2 py-2 font-medium text-gray-500">Name</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500">Botanical Name</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500">Common Name</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500 w-40">Category</th>
                <th className="text-left px-2 py-2 font-medium text-gray-500">Notes</th>
                <th className="w-12 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {plants.map((plant) => (
                <PlantRow
                  key={plant.id}
                  plant={plant}
                  onUpdate={(meta) => doUpdate(plant.id, meta)}
                  onDelete={() => doRemove(plant.id)}
                  allSubcategories={allSubcategories}
                />
              ))}
              {plants.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    No {isPlan ? 'symbols' : 'plants'} uploaded yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PlantRow({
  plant,
  onUpdate,
  onDelete,
  allSubcategories,
}: {
  plant: CustomStamp;
  onUpdate: (meta: PlantMeta) => void;
  onDelete: () => void;
  allSubcategories: { id: string; label: string }[];
}) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50 group">
      {/* Thumbnail */}
      <td className="px-2 py-1.5">
        <div
          className="w-10 h-10 rounded bg-contain bg-center bg-no-repeat border border-gray-200"
          style={{ backgroundImage: `url(${plant.dataUrl})` }}
        />
      </td>
      {/* Name */}
      <td className="px-2 py-1.5">
        <EditableCell
          value={plant.name}
          placeholder="Name"
          onCommit={(v) => onUpdate({ name: v })}
        />
      </td>
      {/* Botanical Name */}
      <td className="px-2 py-1.5">
        <EditableCell
          value={plant.botanicalName ?? ''}
          placeholder="Botanical name"
          italic
          onCommit={(v) => onUpdate({ botanicalName: v })}
        />
      </td>
      {/* Common Name */}
      <td className="px-2 py-1.5">
        <EditableCell
          value={plant.commonName ?? ''}
          placeholder="Common name"
          onCommit={(v) => onUpdate({ commonName: v })}
        />
      </td>
      {/* Category */}
      <td className="px-2 py-1.5">
        <select
          value={plant.category}
          onChange={(e) => onUpdate({ category: e.target.value })}
          className="w-full bg-transparent border border-transparent hover:border-gray-300 focus:border-blue-400 rounded px-1.5 py-1 text-sm outline-none cursor-pointer"
        >
          {allSubcategories.map((sub) => (
            <option key={sub.id} value={sub.id}>{sub.label}</option>
          ))}
        </select>
      </td>
      {/* Notes */}
      <td className="px-2 py-1.5">
        <EditableCell
          value={plant.notes ?? ''}
          placeholder="Notes"
          onCommit={(v) => onUpdate({ notes: v })}
        />
      </td>
      {/* Delete */}
      <td className="px-2 py-1.5">
        <button
          onClick={() => {
            if (window.confirm(`Delete "${plant.name}"? This cannot be undone.`)) {
              onDelete();
            }
          }}
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
          title="Delete"
        >
          <Trash2 size={16} />
        </button>
      </td>
    </tr>
  );
}

function EditableCell({
  value,
  placeholder,
  italic,
  onCommit,
}: {
  value: string;
  placeholder: string;
  italic?: boolean;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onCommit(trimmed);
    }
  }, [draft, value, onCommit]);

  if (editing) {
    return (
      <input
        autoFocus
        className={`w-full bg-white border border-blue-400 rounded px-1.5 py-1 text-sm outline-none ${italic ? 'italic' : ''}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }

  return (
    <div
      className={`px-1.5 py-1 rounded border border-transparent hover:border-gray-300 cursor-text min-h-[28px] ${
        italic ? 'italic' : ''
      } ${value ? 'text-gray-800' : 'text-gray-300'}`}
      onClick={() => { setDraft(value); setEditing(true); }}
    >
      {value || placeholder}
    </div>
  );
}
