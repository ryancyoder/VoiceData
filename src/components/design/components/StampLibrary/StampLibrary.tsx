import { useCallback } from 'react';
import { Plus, X, ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useCustomStampStore } from '../../store/useCustomStampStore';
import { TextureGrid } from './TextureGrid';
import type { StampCategory } from '../../types';

const PLANT_CATEGORIES: { id: StampCategory; label: string }[] = [
  { id: 'shade-trees', label: 'Shade Trees' },
  { id: 'ornamental-trees', label: 'Ornamental Trees' },
  { id: 'grasses', label: 'Grasses' },
  { id: 'shrubs', label: 'Shrubs' },
  { id: 'perennials', label: 'Perennials' },
  { id: 'ground-cover', label: 'Ground Cover' },
];

type SidebarTab = 'objects' | 'textures';

export function StampLibrary() {
  const sidebarCollapsed = useProjectStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useProjectStore((s) => s.toggleSidebar);
  const activeCategory = useProjectStore((s) => s.activeCategory ?? 'shade-trees') as StampCategory;
  const setActiveCategory = useProjectStore((s) => s.setActiveCategory);
  const activeTab = useProjectStore((s) => s.activeSidebarTab ?? 'objects') as SidebarTab;
  const setActiveTab = useProjectStore((s) => s.setActiveSidebarTab);

  if (sidebarCollapsed) {
    return (
      <div className="w-12 bg-white border-r border-gray-200 flex flex-col items-center py-2 gap-2 shrink-0">
        <button
          onClick={toggleSidebar}
          className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
      {/* Top bar: Objects | Surfaces toggle + collapse */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-100">
        <div className="flex bg-gray-100 rounded-lg p-0.5 flex-1 mr-2">
          <button
            onClick={() => setActiveTab('objects')}
            className={`flex-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'objects' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            Objects
          </button>
          <button
            onClick={() => setActiveTab('textures')}
            className={`flex-1 px-2 py-1 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
              activeTab === 'textures' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            <Layers size={12} />
            Surfaces
          </button>
        </div>
        <button
          onClick={toggleSidebar}
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 shrink-0"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {activeTab === 'textures' ? (
        <TextureGrid />
      ) : (
        <ObjectsPanel activeCategory={activeCategory} setActiveCategory={setActiveCategory} />
      )}
    </div>
  );
}

function ObjectsPanel({ activeCategory, setActiveCategory }: {
  activeCategory: StampCategory;
  setActiveCategory: (cat: string) => void;
}) {
  const customStamps = useCustomStampStore((s) => s.stamps);
  const removeStamp = useCustomStampStore((s) => s.removeStamp);
  const setPendingStamp = useProjectStore((s) => s.setPendingStamp);
  const pendingStampAssetId = useProjectStore((s) => s.pendingStampAssetId);

  // Filter stamps for active category (exclude textures)
  const categoryStamps = customStamps.filter(
    (s) => s.category === activeCategory && !s.name.startsWith('tex-')
  );

  const handleUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/webp,image/jpeg';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) return;
      for (const file of Array.from(files)) {
        useCustomStampStore.getState().addStampWithCategory(file, activeCategory);
      }
    };
    input.click();
  }, [activeCategory]);

  const handlePaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string;
            const img = new Image();
            img.onload = () => {
              useCustomStampStore.getState().addStampFromDataUrl(
                `Pasted ${new Date().toLocaleTimeString()}`,
                dataUrl, img.naturalWidth, img.naturalHeight,
                activeCategory
              );
            };
            img.src = dataUrl;
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
    } catch { /* clipboard not available */ }
  }, [activeCategory]);

  return (
    <>
      {/* Category selector — horizontal scroll */}
      <div className="flex overflow-x-auto border-b border-gray-100 shrink-0 gap-0.5 px-1 py-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        {PLANT_CATEGORIES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveCategory(id)}
            className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-medium transition-colors whitespace-nowrap ${
              activeCategory === id
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Add buttons */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-gray-50">
        <button
          onClick={handleUpload}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[11px] font-medium hover:bg-blue-100 transition-colors select-none"
        >
          <Plus size={12} />
          Upload
        </button>
        <button
          onClick={handlePaste}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[11px] font-medium hover:bg-purple-100 transition-colors select-none"
        >
          Paste
        </button>
      </div>

      {/* Vertical scrolling object list */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {categoryStamps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <Plus size={24} className="text-gray-300" />
            </div>
            <p className="text-xs text-gray-400">
              No objects yet. Upload transparent PNGs for this category.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center py-1 gap-1">
            {categoryStamps.map((stamp) => {
              const isActive = pendingStampAssetId === stamp.id;
              return (
                <div
                  key={stamp.id}
                  className={`relative w-full px-2 group ${isActive ? '' : ''}`}
                  style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                >
                  <div
                    onClick={() => setPendingStamp(isActive ? null : stamp.id)}
                    className={`flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-colors ${
                      isActive ? 'bg-blue-100 ring-2 ring-blue-400' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div
                      className="w-14 h-14 shrink-0 rounded bg-gray-50 bg-contain bg-center bg-no-repeat"
                      style={{ backgroundImage: `url(${stamp.dataUrl})` }}
                    />
                    {/* Name */}
                    <span className={`text-[11px] leading-tight flex-1 truncate ${
                      isActive ? 'text-blue-600 font-medium' : 'text-gray-600'
                    }`}>
                      {stamp.name}
                    </span>
                    {/* Delete */}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeStamp(stamp.id); }}
                      className="w-6 h-6 flex items-center justify-center rounded-full text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-opacity shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-300 text-center py-1.5 px-2 border-t border-gray-50">
        Tap to select, then tap photo to place
      </p>
    </>
  );
}
