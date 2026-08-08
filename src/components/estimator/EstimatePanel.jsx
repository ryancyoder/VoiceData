import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import EstimateRow from './EstimateRow';
import EstimateHeader from './EstimateHeader';
import EstimateSummary from './EstimateSummary';
import TakeOffGroupRow from './TakeOffGroupRow';

export default function EstimatePanel({
  estimate,
  planShapes = [],
  onUpdateField,
  onUpdateGroup,
  onToggleGroupCollapse,
  onUpdateItem,
  onUpdateTakeoff,
  onUpdateWallDimensions,
  onRemoveRow,
  onSaveAsKit,
  activeGroupId,
  onSetActiveGroup,
  subtotal,
  metacategoryTotals,
  totalLoads,
  taxAmount,
  total,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'estimate-panel' });

  const rowIds = estimate.rows.map(r => r.id);
  const hasRows = estimate.rows.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <EstimateHeader estimate={estimate} onUpdate={onUpdateField} />

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Column headers */}
        {hasRows && (
          <div className="flex items-center gap-3 px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            <span className="w-6 shrink-0 print:hidden" />
            <span className="w-6 shrink-0" />
            <span className="w-20 text-center">Qty</span>
            <span className="flex-1">Item</span>
            <span className="w-24 text-right">$/Unit</span>
            <span className="w-24 text-right">Total</span>
            <span className="w-6 shrink-0 print:hidden" />
          </div>
        )}

        {/* Drop zone + sortable list */}
        <div
          ref={setNodeRef}
          className={`
            min-h-32 rounded-xl transition-colors duration-150
            ${isOver
              ? 'bg-green-50 border-2 border-dashed border-green-400'
              : !hasRows
                ? 'border-2 border-dashed border-gray-200 bg-gray-50/50'
                : ''
            }
          `}
        >
          {!hasRows ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400">
              <svg className="w-8 h-8 mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              <p className="text-sm font-medium">Drag items here from the catalog</p>
              <p className="text-xs mt-0.5">or drag a Take Off Group to organize items</p>
            </div>
          ) : (
            <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {estimate.rows.map(row => {
                  if (row.type === 'group') {
                    return (
                      <TakeOffGroupRow
                        key={row.id}
                        group={row}
                        onUpdate={onUpdateGroup}
                        onToggleCollapse={onToggleGroupCollapse}
                        onRemove={onRemoveRow}
                        onSaveAsKit={onSaveAsKit}
                        isActive={row.id === activeGroupId}
                        onSetActive={onSetActiveGroup}
                        hasMapLink={planShapes.some(s => s.groupId === row.id)}
                      >
                        <SortableContext
                          items={row.items.map(i => i.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="flex flex-col gap-1.5 py-2">
                            {row.items.map(item => (
                              <EstimateRow
                                key={item.id}
                                item={item}
                                isGrouped={true}
                                onUpdate={onUpdateItem}
                                onUpdateTakeoff={onUpdateTakeoff}
                                onUpdateWallDimensions={onUpdateWallDimensions}
                                onRemove={onRemoveRow}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </TakeOffGroupRow>
                    );
                  }
                  return (
                    <EstimateRow
                      key={row.id}
                      item={row}
                      isGrouped={false}
                      onUpdate={onUpdateItem}
                      onUpdateTakeoff={onUpdateTakeoff}
                      onUpdateWallDimensions={onUpdateWallDimensions}
                      onRemove={onRemoveRow}
                    />
                  );
                })}
              </div>
            </SortableContext>
          )}
        </div>

        {hasRows && (
          <EstimateSummary
            subtotal={subtotal}
            metacategoryTotals={metacategoryTotals}
            totalLoads={totalLoads}
            taxAmount={taxAmount}
            total={total}
            taxRate={estimate.taxRate}
            onTaxRateChange={v => onUpdateField('taxRate', v)}
          />
        )}
      </div>
    </div>
  );
}
