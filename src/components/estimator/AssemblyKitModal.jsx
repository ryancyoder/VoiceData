import { useState, useEffect, useRef } from 'react';
import { SHAPE_COLORS } from '@/lib/estimator/useEstimate';

export default function AssemblyKitModal({ groupLabel, itemCount, defaultColor, onSave, onClose }) {
  const [name, setName] = useState(groupLabel ?? '');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(defaultColor ?? SHAPE_COLORS[0]);
  const [takeoffUnit, setTakeoffUnit] = useState(null); // null | 'area' | 'linear'
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, description.trim(), { color, takeoffUnit });
  }

  const unitOptions = [
    { value: null,     label: 'Either',  title: 'Shows in both area and linear sub-toolbars' },
    { value: 'area',   label: 'Area',    title: 'Shows only in the area shape sub-toolbar' },
    { value: 'linear', label: 'Linear',  title: 'Shows only in the linear shape sub-toolbar' },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-96">
        <h2 className="text-base font-bold text-gray-800 mb-1">Save as Assembly Kit</h2>
        <p className="text-xs text-gray-400 mb-4">
          Saves {itemCount} item{itemCount !== 1 ? 's' : ''} and their assembly relationships to your kit library.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Kit Name *</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Lawn Installation"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              Description <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Full lawn install per sq ft — seed, topsoil, erosion blanket"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none
                         focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent
                         placeholder:text-gray-300"
            />
          </div>

          {/* Takeoff unit */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Default Takeoff Type</label>
            <div className="flex gap-2">
              {unitOptions.map(opt => (
                <button
                  key={String(opt.value)}
                  type="button"
                  title={opt.title}
                  onClick={() => setTakeoffUnit(opt.value)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors
                    ${takeoffUnit === opt.value
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              {takeoffUnit === 'area' && 'Kit will appear in the Area tool sub-toolbar in plan view.'}
              {takeoffUnit === 'linear' && 'Kit will appear in the Linear tool sub-toolbar in plan view.'}
              {takeoffUnit === null && 'Kit will appear in both area and linear sub-toolbars.'}
            </p>
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Plan Annotation Color</label>
            <div className="flex gap-2 flex-wrap">
              {SHAPE_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-all border-2
                    ${color === c ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400
                         text-white font-semibold text-sm py-2 rounded-lg transition-colors"
            >
              Save Kit
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-600
                         font-semibold text-sm py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
