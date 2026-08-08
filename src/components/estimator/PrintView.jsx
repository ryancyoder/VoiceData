import { METACATEGORIES } from '@/lib/estimator/catalog';

const META_LABELS = {
  MATERIAL:  'Material',
  LABOR:     'Labor',
  EQUIPMENT: 'Equipment',
  LOGISTICS: 'Logistics',
};

function fmt(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function itemLineTotal(item) {
  if (item.isWallAssembly) {
    return (item.faceFt * item.pricePerFaceFt) + (item.linearFt * item.pricePerLinearFt);
  }
  return item.quantity * item.unitPrice;
}

function groupTotal(group) {
  return group.items.reduce((sum, item) => sum + itemLineTotal(item), 0);
}

// ── Shared components ──────────────────────────────────────────────────────

function PrintHeader({ estimate }) {
  return (
    <div className="flex justify-between items-start mb-4 pb-3 border-b border-gray-200">
      <div>
        <h1 className="text-lg font-bold text-green-800 tracking-tight">Landscape Estimate</h1>
        <p className="text-gray-500 text-[10px] mt-0.5">
          Client: <strong>{estimate.clientName || '—'}</strong>
          {estimate.projectName && (
            <> &nbsp;·&nbsp; Project: <strong>{estimate.projectName}</strong></>
          )}
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs font-bold text-gray-800">Your Company Name</p>
        <p className="text-gray-400 text-[10px]">{estimate.date}</p>
      </div>
    </div>
  );
}

function MetaSummaryTable({ metacategoryTotals, totalLoads }) {
  const activeMetas = METACATEGORIES.filter(m => (metacategoryTotals?.[m] ?? 0) > 0);
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className="bg-gray-100">
          <th className="text-left px-2 py-1 text-gray-600 font-semibold">Cost Type</th>
          <th className="text-right px-2 py-1 text-gray-600 font-semibold">Amount</th>
        </tr>
      </thead>
      <tbody>
        {activeMetas.map(meta => (
          <tr key={meta} className="border-t border-gray-100">
            <td className="px-2 py-1 text-gray-700">
              {META_LABELS[meta]}
              {meta === 'LOGISTICS' && totalLoads > 0 && (
                <span className="ml-1.5 text-gray-400 text-[10px]">
                  ({totalLoads} load{totalLoads !== 1 ? 's' : ''})
                </span>
              )}
            </td>
            <td className="px-2 py-1 text-right font-medium">${fmt(metacategoryTotals[meta])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalsBlock({ subtotal, taxAmount, total, estimate }) {
  return (
    <div className="border border-gray-200 rounded overflow-hidden text-[11px]">
      <div className="flex justify-between px-3 py-1.5">
        <span className="text-gray-600">Subtotal</span>
        <span className="font-medium">${fmt(subtotal)}</span>
      </div>
      <div className="flex justify-between px-3 py-1.5 border-t border-gray-100">
        <span className="text-gray-600">Tax ({estimate.taxRate}%)</span>
        <span className="font-medium">${fmt(taxAmount)}</span>
      </div>
      <div className="flex justify-between px-3 py-2 bg-green-800 text-white">
        <span className="font-bold text-xs">Total</span>
        <span className="font-bold text-sm">${fmt(total)}</span>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <p className="text-[9px] text-gray-400 text-center border-t mt-4 pt-3">
      This estimate is valid for 30 days. Thank you for your business.
    </p>
  );
}

// ── Detailed template ──────────────────────────────────────────────────────

function renderDetailRow(item, idx) {
  const lineTotal = itemLineTotal(item);
  const bg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';

  const qtyCell = item.isWallAssembly
    ? <>{item.linearFt} LF × {item.height} ft</>
    : item.isAssembly
    ? <>{item.takeoffQty} <span className="text-gray-400">→</span> {item.quantity.toFixed(1)} {item.unit}</>
    : item.quantity;

  const unitCell = item.isWallAssembly ? 'LF×H'
    : item.isAssembly ? item.takeoffUnit
    : item.unit;

  const priceCell = item.isWallAssembly ? (
    <>
      <span className="block">${fmt(item.pricePerFaceFt)}<span className="text-gray-400">/ff</span></span>
      <span className="block text-gray-400 text-[9px]">${fmt(item.pricePerLinearFt)}/lf</span>
    </>
  ) : `$${fmt(item.unitPrice)}`;

  const rows = [
    <tr key={item.id} className={bg}>
      <td className="px-3 py-1 font-medium">{item.name}</td>
      <td className="px-2 py-1 text-center text-gray-500">{unitCell}</td>
      <td className="px-2 py-1 text-center">{qtyCell}</td>
      <td className="px-2 py-1 text-right">{priceCell}</td>
      <td className="px-3 py-1 text-right font-semibold">${fmt(lineTotal)}</td>
    </tr>,
  ];

  if (item.notes) {
    rows.push(
      <tr key={`${item.id}-n`} className={bg}>
        <td colSpan={5} className="px-3 pb-1 text-[9px] text-gray-400 italic leading-tight">
          {item.notes}
        </td>
      </tr>
    );
  }

  return rows;
}

function DetailedTemplate({ estimate, subtotal, metacategoryTotals, totalLoads, taxAmount, total }) {
  return (
    <div className="p-6 max-w-4xl mx-auto text-[11px]">
      <PrintHeader estimate={estimate} />

      <table className="w-full border-collapse mb-5">
        <thead>
          <tr className="bg-green-800 text-white text-[10px]">
            <th className="text-left px-3 py-1.5 rounded-tl">Item</th>
            <th className="text-center px-2 py-1.5">Unit</th>
            <th className="text-center px-2 py-1.5">Qty</th>
            <th className="text-right px-2 py-1.5">$/Unit</th>
            <th className="text-right px-3 py-1.5 rounded-tr">Total</th>
          </tr>
        </thead>
        <tbody>
          {estimate.rows.flatMap((row, rowIdx) => {
            if (row.type === 'group') {
              const gt = groupTotal(row);
              return [
                <tr key={`g-${row.id}`} className="bg-indigo-50 border-t-2 border-indigo-200">
                  <td colSpan={4} className="px-3 py-1.5">
                    <span className="font-semibold text-indigo-800 text-[11px]">
                      {row.label || 'Take Off Group'}
                    </span>
                    {row.sqFt > 0 && (
                      <span className="ml-2 text-indigo-500 text-[9px]">
                        {row.sqFt.toLocaleString()} sq ft
                      </span>
                    )}
                    {row.linearFt > 0 && (
                      <span className="ml-1.5 text-indigo-500 text-[9px]">
                        {row.linearFt.toLocaleString()} ln ft
                      </span>
                    )}
                    {row.notes && (
                      <span className="ml-2 text-indigo-400 italic text-[9px]">{row.notes}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-bold text-indigo-800">
                    ${fmt(gt)}
                  </td>
                </tr>,
                ...(row.items.flatMap((item, idx) => renderDetailRow(item, idx))),
              ];
            }
            return renderDetailRow(row, rowIdx);
          })}
        </tbody>
      </table>

      <div className="flex justify-between items-start gap-6">
        <div className="flex-1">
          <MetaSummaryTable metacategoryTotals={metacategoryTotals} totalLoads={totalLoads} />
        </div>
        <div className="w-52 shrink-0">
          <TotalsBlock subtotal={subtotal} taxAmount={taxAmount} total={total} estimate={estimate} />
        </div>
      </div>

      <Footer />
    </div>
  );
}

// ── Summary template ───────────────────────────────────────────────────────

function SummaryTemplate({ estimate, subtotal, metacategoryTotals, totalLoads, taxAmount, total }) {
  const groups = estimate.rows.filter(r => r.type === 'group');
  const topItems = estimate.rows.filter(r => r.type === 'item');
  const topTotal = topItems.reduce((s, i) => s + itemLineTotal(i), 0);

  return (
    <div className="p-6 max-w-3xl mx-auto text-[11px]">
      <PrintHeader estimate={estimate} />

      {groups.length > 0 && (
        <div className="mb-5">
          <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
            Scope Summary
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-green-800 text-white text-[10px]">
                <th className="text-left px-3 py-1.5 rounded-tl">Group</th>
                <th className="text-center px-2 py-1.5">Sq Ft</th>
                <th className="text-center px-2 py-1.5">Ln Ft</th>
                <th className="text-right px-3 py-1.5 rounded-tr">Total</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={g.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-1.5 font-medium">{g.label || 'Take Off Group'}</td>
                  <td className="px-2 py-1.5 text-center text-gray-600">
                    {g.sqFt > 0 ? g.sqFt.toLocaleString() : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-center text-gray-600">
                    {g.linearFt > 0 ? g.linearFt.toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold">${fmt(groupTotal(g))}</td>
                </tr>
              ))}
              {topItems.length > 0 && (
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td className="px-3 py-1.5 italic text-gray-500" colSpan={3}>
                    Additional items
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold">${fmt(topTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between items-start gap-6">
        <div className="flex-1">
          <MetaSummaryTable metacategoryTotals={metacategoryTotals} totalLoads={totalLoads} />
        </div>
        <div className="w-52 shrink-0">
          <TotalsBlock subtotal={subtotal} taxAmount={taxAmount} total={total} estimate={estimate} />
        </div>
      </div>

      <Footer />
    </div>
  );
}

// ── Export ─────────────────────────────────────────────────────────────────

export default function PrintView({ estimate, subtotal, metacategoryTotals, totalLoads, taxAmount, total, template = 'detailed' }) {
  return (
    <div className="hidden print:block">
      {template === 'summary' ? (
        <SummaryTemplate
          estimate={estimate}
          subtotal={subtotal}
          metacategoryTotals={metacategoryTotals}
          totalLoads={totalLoads}
          taxAmount={taxAmount}
          total={total}
        />
      ) : (
        <DetailedTemplate
          estimate={estimate}
          subtotal={subtotal}
          metacategoryTotals={metacategoryTotals}
          totalLoads={totalLoads}
          taxAmount={taxAmount}
          total={total}
        />
      )}
    </div>
  );
}
