import { useState, useCallback } from 'react';
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_COLORS } from '@/lib/estimator/catalog';
import { ITEM_TYPES } from './PlanCanvas';

// Categories where all items share a single delivery rate
const UNIVERSAL_DELIVERY_CATEGORIES = ['bulk_materials'];

const UNIT_OPTIONS = [
  { value: 'sq ft',  label: 'Sq Ft'  },
  { value: 'ln ft',  label: 'Ln Ft'  },
  { value: 'fc ft',  label: 'Fc Ft'  },
  { value: 'cu yd',  label: 'Cu Yd'  },
  { value: 'ea',     label: 'Ea'     },
  { value: 'bag',    label: 'Bag'    },
  { value: 'roll',   label: 'Roll'   },
  { value: 'plt',    label: 'Plt'    },
  { value: 'hr',     label: 'Hr'     },
  { value: 'day',    label: 'Day'    },
];

const TAKEOFF_UNIT_OPTIONS = [
  { value: 'sq ft',  label: 'Sq Ft'  },
  { value: 'ln ft',  label: 'Ln Ft'  },
];

function Cell({ children }) {
  return <td className="py-2.5 pr-3 align-middle">{children}</td>;
}

function TextInput({ value, onChange }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full border border-gray-200 rounded px-2 py-1 text-sm
                 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
    />
  );
}

function NumberInput({ value, onChange, min = 0, step = 'any', prefix }) {
  return (
    <div className="relative">
      {prefix && (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className={`w-full border border-gray-200 rounded py-1 text-sm text-right
                    focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent
                    ${prefix ? 'pl-5 pr-2' : 'px-2'}`}
      />
    </div>
  );
}

function Dash() {
  return <span className="text-gray-300 text-sm">—</span>;
}

export default function CatalogEditor({ items, deliveryRate, onUpdateDeliveryRate, onUpdate, onAdd, onRemove, onSave, onClose }) {
  const [activeCategory, setActiveCategory] = useState('plants');
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved'

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    await onSave();
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  }, [onSave]);

  const categoryItems = items.filter(i => i.category === activeCategory);
  const ASSEMBLY_CATEGORIES = ['bulk_materials', 'standard_materials', 'lawn', 'edging', 'drainage', 'hardscape', 'lighting'];
  const hasAssemblies = categoryItems.some(i => i.isAssembly) || ASSEMBLY_CATEGORIES.includes(activeCategory);
  const isBulkMaterials = activeCategory === 'bulk_materials';
  const hasUnitsPerLoad = isBulkMaterials && categoryItems.some(i => i.unitsPerLoad != null);
  const isUniversalDelivery = UNIVERSAL_DELIVERY_CATEGORIES.includes(activeCategory);
  const hasWallAssemblies = categoryItems.some(i => i.isWallAssembly);
  const isPlantsCategory = activeCategory === 'plants';
  const isItemsCategory = activeCategory !== 'plants';
  const colors = CATEGORY_COLORS[activeCategory];

  function toggleAssembly(item, checked) {
    onUpdate(item.id, 'isAssembly', checked);
    if (checked) {
      if (!item.takeoffUnit) onUpdate(item.id, 'takeoffUnit', 'sq ft');
      if (!item.coverageRate) onUpdate(item.id, 'coverageRate', 1);
    }
  }

  // Total column count for the colspan on the Add row
  const colCount = 3
    + (hasAssemblies ? 4 : 0)   // checkbox + takeoffUnit + coverageRate + roundTo
    + (hasUnitsPerLoad ? 2 : 0) // unitsPerLoad + deliveryFee
    + (hasWallAssemblies ? 2 : 0)
    + 1 // symbol column (Plan Symbol for plants, Sym for others)
    + 1;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Catalog Settings</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Edit names, units, pricing, coverage rates, and delivery settings
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saveState === 'saving'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${saveState === 'saved'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-green-600 hover:bg-green-700 text-white disabled:opacity-60'
                }`}
            >
              {saveState === 'saved' ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  {saveState === 'saving' ? 'Saving...' : 'Save to Catalog'}
                </>
              )}
            </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            title="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-1 px-6 pt-3 pb-0 border-b border-gray-100">
          {CATEGORIES.map(cat => {
            const c = CATEGORY_COLORS[cat];
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`
                  px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors
                  ${isActive
                    ? `${c.text} border-current`
                    : 'text-gray-400 border-transparent hover:text-gray-600'
                  }
                `}
              >
                {CATEGORY_LABELS[cat]}
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full
                  ${isActive ? c.badge + ' ' + c.text : 'bg-gray-100 text-gray-400'}`}>
                  {items.filter(i => i.category === cat).length}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="p-6 overflow-x-auto">

          {/* Universal delivery rate banner */}
          {isUniversalDelivery && (
            <div className="flex items-center gap-4 mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">Delivery Rate</p>
                <p className="text-xs text-amber-600 mt-0.5">One rate applies to all deliveries — toggle per item with the Delivery Fee checkbox</p>
              </div>
              <div className="w-32">
                <NumberInput
                  value={deliveryRate}
                  onChange={onUpdateDeliveryRate}
                  step="0.01"
                  prefix="$"
                />
              </div>
              <span className="text-xs text-amber-600">per load</span>
            </div>
          )}

          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                <th className="text-left pb-3 pr-3 min-w-[12rem]">Name</th>
                <th className="text-left pb-3 pr-3 w-24">Billing<span className="block">Unit</span></th>
                {isItemsCategory && (
                  <th className="text-center pb-3 pr-3 w-12">Sym</th>
                )}
                <th className="text-right pb-3 pr-3 w-28">$/Unit</th>
                {hasAssemblies && <>
                  <th className="text-center pb-3 pr-3 w-10">Asm</th>
                  <th className="text-left pb-3 pr-3 w-28">Take Off<span className="block">Unit</span></th>
                  <th className="text-right pb-3 pr-3 w-24">Coverage<span className="block">Rate</span></th>
                  <th className="text-right pb-3 pr-3 w-28">
                    Round To
                    <span className="block text-gray-300 normal-case tracking-normal font-normal">
                      billing units
                    </span>
                  </th>
                </>}
                {hasUnitsPerLoad && (<>
                  <th className="text-right pb-3 pr-3 w-28">
                    Units / Load
                    <span className="block text-gray-300 normal-case tracking-normal font-normal">
                      billing units
                    </span>
                  </th>
                  <th className="text-center pb-3 pr-3 w-24">
                    Delivery
                    <span className="block text-gray-300 normal-case tracking-normal font-normal">
                      Fee
                    </span>
                  </th>
                </>)}
                {hasWallAssemblies && <>
                  <th className="text-right pb-3 pr-3 w-32">
                    $/Face Ft
                    <span className="block text-gray-300 normal-case tracking-normal font-normal">
                      block / face area
                    </span>
                  </th>
                  <th className="text-right pb-3 pr-3 w-32">
                    $/Lin Ft
                    <span className="block text-gray-300 normal-case tracking-normal font-normal">
                      coping &amp; base
                    </span>
                  </th>
                </>}
                {isPlantsCategory && (
                  <th className="text-left pb-3 pr-3 w-36">Plan Symbol</th>
                )}
                {/* Delete column */}
                <th className="pb-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {categoryItems.map(item => (
                <tr key={item.id} className="group border-t border-gray-50 hover:bg-gray-50/60 transition-colors">
                  <Cell>
                    <TextInput value={item.name} onChange={v => onUpdate(item.id, 'name', v)} />
                  </Cell>
                  <Cell>
                    <select
                      value={item.unit}
                      onChange={e => onUpdate(item.id, 'unit', e.target.value)}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                    >
                      {UNIT_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Cell>
                  {isItemsCategory && (
                    <td className="py-2.5 pr-3 align-middle">
                      {item.unit === 'ea'
                        ? <select
                            value={item.itemSymbol ?? ''}
                            onChange={e => onUpdate(item.id, 'itemSymbol', e.target.value || null)}
                            className="w-12 border border-gray-200 rounded px-1 py-1 text-sm text-center
                                       focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                          >
                            <option value="">—</option>
                            {ITEM_TYPES.map(it => (
                              <option key={it.key} value={it.key}>{it.symbol}</option>
                            ))}
                          </select>
                        : <Dash />
                      }
                    </td>
                  )}
                  <Cell>
                    <NumberInput value={item.unitPrice} onChange={v => onUpdate(item.id, 'unitPrice', v)} step="0.01" prefix="$" />
                  </Cell>

                  {hasAssemblies && <>
                    <td className="py-2.5 pr-3 align-middle text-center">
                      <input
                        type="checkbox"
                        checked={!!item.isAssembly}
                        onChange={e => toggleAssembly(item, e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-400 cursor-pointer"
                      />
                    </td>
                    <Cell>
                      {item.isAssembly
                        ? <select
                            value={item.takeoffUnit ?? 'sq ft'}
                            onChange={e => onUpdate(item.id, 'takeoffUnit', e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1 text-sm
                                       focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                          >
                            {TAKEOFF_UNIT_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        : <Dash />}
                    </Cell>
                    <Cell>
                      {item.isAssembly
                        ? <NumberInput value={item.coverageRate ?? 1} onChange={v => onUpdate(item.id, 'coverageRate', v)} min={0.01} step="any" />
                        : <Dash />}
                    </Cell>
                    <Cell>
                      {item.isAssembly
                        ? <NumberInput value={item.roundTo ?? ''} onChange={v => onUpdate(item.id, 'roundTo', v || null)} min={0.01} step="any" />
                        : <Dash />}
                    </Cell>
                  </>}

                  {hasUnitsPerLoad && (<>
                    <Cell>
                      <NumberInput value={item.unitsPerLoad ?? 0} onChange={v => onUpdate(item.id, 'unitsPerLoad', v)} min={0} step={1} />
                    </Cell>
                    <td className="py-2.5 pr-3 align-middle text-center">
                      <input
                        type="checkbox"
                        checked={!!item.deliveryFee}
                        onChange={e => onUpdate(item.id, 'deliveryFee', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 cursor-pointer"
                      />
                    </td>
                  </>)}

                  {hasWallAssemblies && <>
                    <Cell>
                      {item.isWallAssembly
                        ? <NumberInput value={item.pricePerFaceFt} onChange={v => onUpdate(item.id, 'pricePerFaceFt', v)} step="0.01" prefix="$" />
                        : <Dash />}
                    </Cell>
                    <Cell>
                      {item.isWallAssembly
                        ? <NumberInput value={item.pricePerLinearFt} onChange={v => onUpdate(item.id, 'pricePerLinearFt', v)} step="0.01" prefix="$" />
                        : <Dash />}
                    </Cell>
                  </>}

                  {isPlantsCategory && (
                    <Cell>
                      <select
                        value={item.planSymbol ?? ''}
                        onChange={e => onUpdate(item.id, 'planSymbol', e.target.value || null)}
                        className="w-full border border-gray-200 rounded px-2 py-1 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                      >
                        <option value="">None</option>
                        <option value="shade-tree">🌳 Shade Tree</option>
                        <option value="evergreen">🌲 Evergreen</option>
                        <option value="shrub">🌿 Shrub</option>
                        <option value="perennial">🌸 Perennial</option>
                      </select>
                    </Cell>
                  )}

                  {/* Delete button */}
                  <td className="py-2.5 align-middle">
                    <button
                      onClick={() => onRemove(item.id)}
                      className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                      title="Remove item"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}

              {/* Add item row */}
              <tr>
                <td colSpan={colCount} className="pt-3">
                  <button
                    onClick={() => onAdd(activeCategory)}
                    className={`
                      flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
                      border border-dashed transition-colors
                      ${colors.border} ${colors.text} hover:${colors.bg}
                    `}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add {CATEGORY_LABELS[activeCategory]} Item
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Step interval hints */}
          {hasUnitsPerLoad && (
            <div className="mt-4 flex flex-wrap gap-3">
              {categoryItems.filter(i => i.unitsPerLoad).map(item => (
                <div key={item.id} className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
                  <span className="font-medium text-gray-600">{item.name}:</span>{' '}
                  1 load = {(item.coverageRate * item.unitsPerLoad).toLocaleString()} {item.takeoffUnit}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
