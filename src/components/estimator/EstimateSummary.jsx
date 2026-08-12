import { METACATEGORIES } from '@/lib/estimator/catalog';

function fmt(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const META_LABELS = {
  MATERIAL:  'Material',
  LABOR:     'Labor',
  EQUIPMENT: 'Equipment',
  LOGISTICS: 'Logistics',
};

export default function EstimateSummary({ subtotal, metacategoryTotals, stageTotals, stageOptions = [], totalLoads, taxAmount, total, taxRate, onTaxRateChange }) {
  const activeMetas = METACATEGORIES.filter(m => (metacategoryTotals?.[m] ?? 0) > 0);
  const stageOrder = stageOptions.map(s => s.name);
  const stageLabelOf = (name) => stageOptions.find(s => s.name === name)?.label ?? name;
  // Canonical sequence first (crew order), then any custom stage, then unstaged.
  const stageKeys = [
    ...stageOrder.filter(s => (stageTotals?.[s] ?? 0) !== 0),
    ...Object.keys(stageTotals ?? {}).filter(s => s !== 'unstaged' && !stageOrder.includes(s) && (stageTotals[s] ?? 0) !== 0),
    ...(((stageTotals?.unstaged ?? 0) !== 0) ? ['unstaged'] : []),
  ];
  // Only worth showing the phase breakdown once work is actually split by stage.
  const showStages = stageKeys.filter(s => s !== 'unstaged').length > 0;

  return (
    <div className="mt-4 flex justify-end">
      <div className="w-72 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">

        {/* Metacategory breakdown */}
        {activeMetas.length > 0 && (
          <div className="px-4 pt-3 pb-2 space-y-1.5 border-b border-gray-100">
            {activeMetas.map(meta => (
              <div key={meta} className="flex justify-between text-xs text-gray-500">
                <span>
                  {META_LABELS[meta]}
                  {meta === 'LOGISTICS' && totalLoads > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                      {totalLoads} load{totalLoads !== 1 ? 's' : ''}
                    </span>
                  )}
                </span>
                <span>${fmt(metacategoryTotals[meta])}</span>
              </div>
            ))}
          </div>
        )}

        {/* By operation stage / phase */}
        {showStages && (
          <div className="px-4 pt-3 pb-2 space-y-1.5 border-b border-gray-100">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">By phase</div>
            {stageKeys.map(stage => (
              <div key={stage} className="flex justify-between text-xs text-gray-500">
                <span>{stage === 'unstaged' ? 'Unstaged' : stageLabelOf(stage)}</span>
                <span>${fmt(stageTotals[stage])}</span>
              </div>
            ))}
          </div>
        )}

        <div className="px-4 py-3 space-y-2">
          {/* Subtotal */}
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal</span>
            <span className="font-medium text-gray-800">${fmt(subtotal)}</span>
          </div>

          {/* Tax rate */}
          <div className="flex justify-between items-center text-sm text-gray-600">
            <div className="flex items-center gap-1.5">
              <span>Tax</span>
              <div className="relative w-14">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={taxRate}
                  onChange={e => onTaxRateChange(parseFloat(e.target.value) || 0)}
                  className="w-full text-xs text-right border border-gray-200 rounded px-1.5 pr-4 py-0.5
                             focus:outline-none focus:ring-2 focus:ring-green-400"
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
              </div>
            </div>
            <span className="font-medium text-gray-800">${fmt(taxAmount)}</span>
          </div>
        </div>

        {/* Grand total */}
        <div className="px-4 py-3 bg-green-700 flex justify-between items-center">
          <span className="text-sm font-bold text-white uppercase tracking-wide">Total</span>
          <span className="text-xl font-bold text-white">${fmt(total)}</span>
        </div>
      </div>
    </div>
  );
}
