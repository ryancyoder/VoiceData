import { RefreshCw } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';

const CATEGORIES = [
  { id: 'shade-trees', label: 'Shade Trees' },
  { id: 'ornamental-trees', label: 'Ornamental' },
  { id: 'grasses', label: 'Grasses' },
  { id: 'shrubs', label: 'Shrubs' },
  { id: 'perennials', label: 'Perennials' },
  { id: 'ground-cover', label: 'Ground Cover' },
  { id: 'textures', label: 'Surfaces' },
];

export function CategoryToggle() {
  const activeCategory = useProjectStore((s) => s.activeCategory ?? 'shade-trees');
  const activeSidebarTab = useProjectStore((s) => s.activeSidebarTab ?? 'objects');
  const setActiveCategory = useProjectStore((s) => s.setActiveCategory);
  const setActiveSidebarTab = useProjectStore((s) => s.setActiveSidebarTab);

  const currentId = activeSidebarTab === 'textures' ? 'textures' : activeCategory;
  const currentIndex = CATEGORIES.findIndex((c) => c.id === currentId);

  const handleTap = () => {
    const nextIndex = (currentIndex + 1) % CATEGORIES.length;
    const next = CATEGORIES[nextIndex];
    if (next.id === 'textures') {
      setActiveSidebarTab('textures');
    } else {
      setActiveSidebarTab('objects');
      setActiveCategory(next.id);
    }
  };

  return (
    <button
      onClick={handleTap}
      className="absolute right-32 bottom-[220px] z-20 w-11 h-11 flex items-center justify-center bg-black/30 backdrop-blur-sm text-white rounded-full select-none border border-white/20 active:bg-black/50 transition-colors"
      style={{ WebkitTouchCallout: 'none' }}
      title="Next category"
    >
      <RefreshCw size={18} />
    </button>
  );
}
