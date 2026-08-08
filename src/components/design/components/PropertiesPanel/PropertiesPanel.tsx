import { X, FlipHorizontal, Copy, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { useCustomStampStore } from '../../store/useCustomStampStore';
import { getAssetById } from '../../engine/stampAssets';

export function PropertiesPanel() {
  const propertiesTrayOpen = useProjectStore((s) => s.propertiesTrayOpen);
  const selectedStampId = useProjectStore((s) => s.selectedStampId);
  const stamps = useProjectStore((s) => s.stamps);
  const updateStamp = useProjectStore((s) => s.updateStamp);
  const removeStamp = useProjectStore((s) => s.removeStamp);
  const duplicateStamp = useProjectStore((s) => s.duplicateStamp);
  const selectStamp = useProjectStore((s) => s.selectStamp);
  const pushHistory = useProjectStore((s) => s.pushHistory);

  if (!propertiesTrayOpen || !selectedStampId) return null;

  const stamp = stamps.find((s) => s.id === selectedStampId);
  if (!stamp) return null;

  const isCustom = stamp.assetId.startsWith('custom-');
  const asset = isCustom ? null : getAssetById(stamp.assetId);
  const customStamp = isCustom ? useCustomStampStore.getState().getStamp(stamp.assetId) : null;
  const stampName = asset?.name ?? customStamp?.name ?? 'Unknown';
  if (!asset && !customStamp) return null;

  const handleChange = (field: string, value: number | boolean) => {
    pushHistory();
    updateStamp(stamp.id, { [field]: value });
  };

  const moveZIndex = (direction: 'up' | 'down') => {
    pushHistory();
    const currentZ = stamp.zIndex;
    const swap = stamps.find((s) =>
      direction === 'up' ? s.zIndex === currentZ + 1 : s.zIndex === currentZ - 1
    );
    if (swap) {
      updateStamp(swap.id, { zIndex: currentZ });
    }
    updateStamp(stamp.id, {
      zIndex: direction === 'up' ? currentZ + 1 : Math.max(0, currentZ - 1),
    });
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-20 transition-transform">
      <div className="max-w-2xl mx-auto px-4 py-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-700">{stampName}</span>
          <button
            onClick={() => selectStamp(null)}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400"
          >
            <X size={16} />
          </button>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* Manual Scale */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Size</label>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.05}
              value={stamp.manualScale}
              onChange={(e) => handleChange('manualScale', parseFloat(e.target.value))}
              className="w-24 accent-blue-500"
            />
            <span className="text-xs text-gray-400 w-8">
              {Math.round(stamp.manualScale * 100)}%
            </span>
          </div>

          {/* Opacity */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Opacity</label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={stamp.opacity}
              onChange={(e) => handleChange('opacity', parseFloat(e.target.value))}
              className="w-20 accent-blue-500"
            />
          </div>

          {/* Rotation */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Rotate</label>
            <input
              type="range"
              min={-45}
              max={45}
              step={1}
              value={stamp.rotation}
              onChange={(e) => handleChange('rotation', parseFloat(e.target.value))}
              className="w-20 accent-blue-500"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1 ml-auto">
            <ActionButton
              icon={FlipHorizontal}
              label="Flip"
              active={stamp.flipX}
              onClick={() => handleChange('flipX', !stamp.flipX)}
            />
            <ActionButton
              icon={ArrowUp}
              label="Bring Forward"
              onClick={() => moveZIndex('up')}
            />
            <ActionButton
              icon={ArrowDown}
              label="Send Back"
              onClick={() => moveZIndex('down')}
            />
            <ActionButton
              icon={Copy}
              label="Duplicate"
              onClick={() => duplicateStamp(stamp.id)}
            />
            <ActionButton
              icon={Trash2}
              label="Delete"
              onClick={() => removeStamp(stamp.id)}
              danger
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  danger = false,
}: {
  icon: typeof X;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`
        w-10 h-10 flex items-center justify-center rounded-lg transition-colors
        ${active ? 'bg-blue-100 text-blue-600' : ''}
        ${danger ? 'text-red-400 hover:bg-red-50 hover:text-red-600' : ''}
        ${!active && !danger ? 'text-gray-400 hover:bg-gray-100' : ''}
      `}
    >
      <Icon size={18} />
    </button>
  );
}
