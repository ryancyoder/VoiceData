import { useState, useEffect, useRef, useMemo } from 'react';
import { CATEGORY_COLORS } from '@/lib/estimator/catalog';

export default function QuickPicker({ catalogItems, activeGroup, onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lastAdded, setLastAdded] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return catalogItems.slice(0, 10);
    const q = query.toLowerCase();
    return catalogItems
      .filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      )
      .slice(0, 10);
  }, [query, catalogItems]);

  useEffect(() => setSelectedIndex(0), [filtered]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex];
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  function addItem(item) {
    onAdd(item, activeGroup?.id ?? null);
    setLastAdded(item.name);
    setQuery('');
    setTimeout(() => setLastAdded(null), 1500);
    inputRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) addItem(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search catalog…"
            className="flex-1 text-base outline-none placeholder:text-gray-300"
          />
          {lastAdded ? (
            <span className="text-xs text-green-600 font-medium shrink-0">✓ Added</span>
          ) : (
            <kbd className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">esc</kbd>
          )}
        </div>

        {/* Active group indicator */}
        <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
          </svg>
          {activeGroup
            ? <span>Adding to <span className="font-semibold text-indigo-600">{activeGroup.label}</span></span>
            : <span>Adding to <span className="font-semibold text-gray-600">top level</span></span>
          }
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">No items found</div>
          ) : (
            filtered.map((item, i) => {
              const colors = CATEGORY_COLORS[item.category];
              return (
                <button
                  key={item.id}
                  onClick={() => addItem(item)}
                  className={`
                    w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                    ${i === selectedIndex ? 'bg-indigo-50' : 'hover:bg-gray-50'}
                  `}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">{item.category}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {item.isWallAssembly ? (
                      <p className="text-xs text-gray-500">${item.pricePerFaceFt.toFixed(2)}/ff</p>
                    ) : (
                      <p className="text-xs text-gray-500">${item.unitPrice.toFixed(2)}/{item.unit}</p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
          <span><kbd className="bg-gray-100 px-1 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="bg-gray-100 px-1 rounded">↵</kbd> add item</span>
          <span><kbd className="bg-gray-100 px-1 rounded">esc</kbd> close</span>
          <span className="ml-auto">
            <kbd className="bg-gray-100 px-1 rounded">g</kbd> new group
          </span>
        </div>
      </div>
    </div>
  );
}
