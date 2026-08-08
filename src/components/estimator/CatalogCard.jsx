import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CATEGORY_COLORS } from '@/lib/estimator/catalog';

export default function CatalogCard({ item }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `catalog-${item.id}`,
    data: { type: 'catalog', catalogItem: item },
  });

  const colors = CATEGORY_COLORS[item.category];

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        group relative cursor-grab active:cursor-grabbing
        rounded-lg border p-3 select-none
        ${colors.bg} ${colors.border} border
        hover:shadow-md transition-shadow duration-150
        ${isDragging ? 'shadow-lg ring-2 ring-offset-1' : ''}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-medium text-sm leading-tight ${colors.text}`}>
            {item.name}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {item.isWallAssembly ? (
            <>
              <p className={`text-xs font-semibold ${colors.text}`}>
                ${item.pricePerFaceFt.toFixed(2)}<span className="font-normal text-gray-400">/ff</span>
              </p>
              <p className={`text-xs font-semibold ${colors.text}`}>
                ${item.pricePerLinearFt.toFixed(2)}<span className="font-normal text-gray-400">/lf</span>
              </p>
            </>
          ) : (
            <>
              <p className={`text-xs font-semibold ${colors.text}`}>
                ${item.unitPrice.toFixed(2)}
              </p>
              <p className="text-xs text-gray-500">{item.unit}</p>
            </>
          )}
        </div>
      </div>

      {/* Drag hint */}
      <div className="absolute inset-y-0 left-1.5 flex items-center opacity-0 group-hover:opacity-40 transition-opacity">
        <svg className="w-3 h-3 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z" />
        </svg>
      </div>
    </div>
  );
}
