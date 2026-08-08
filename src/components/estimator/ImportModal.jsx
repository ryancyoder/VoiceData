import { useState } from 'react';
import { buildImportedEstimate } from '@/lib/estimator/useEstimate';

export default function ImportModal({ catalogItems, onImport, onClose }) {
  const [json, setJson] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  function buildPrompt() {
    const names = catalogItems.map(c => `  - ${c.name}`).join('\n');
    return `You are a landscape estimating assistant. Convert the following site walkthrough transcript into a JSON object for the Landscape Estimator app.

AVAILABLE CATALOG ITEMS (use these exact names in the "catalog" field):
${names}

JSON FORMAT:
{
  "projectName": "string",
  "clientName": "string",
  "date": "YYYY-MM-DD",
  "taxRate": 0,
  "notes": "any site notes",
  "groups": [
    {
      "label": "Area name (e.g. Front Bed, Back Patio)",
      "sqFt": 0,
      "linearFt": 0,
      "height": 0,
      "items": [
        { "catalog": "Exact catalog item name", "notes": "optional notes" }
      ]
    }
  ],
  "items": [
    { "catalog": "Exact catalog item name", "quantity": 1, "notes": "optional" }
  ]
}

RULES:
- Use groups for areas with defined dimensions (sqFt/linearFt). Items in groups inherit their quantities from those dimensions automatically.
- Use top-level items[] for labor, equipment, or anything without a defined area.
- Only use catalog item names from the list above. If something has no match, use the closest name and add a note.
- Output ONLY the raw JSON object, no explanation.

TRANSCRIPT:
[paste transcript here]`;
  }

  function handleCopyPrompt() {
    navigator.clipboard.writeText(buildPrompt()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleParse() {
    setError('');
    setPreview(null);
    try {
      const parsed = JSON.parse(json);
      const built = buildImportedEstimate(parsed, catalogItems);
      setPreview(built);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleImport() {
    onImport(preview);
  }

  const hasWarnings = preview && preview.rows.some(row => {
    if (row.type === 'item') return row.notes?.includes('[NOT FOUND IN CATALOG]');
    if (row.type === 'group') return row.items.some(i => i.notes?.includes('[NOT FOUND IN CATALOG]'));
    return false;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Import from Transcript</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Step 1 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700">Step 1 — Copy the AI prompt</p>
              <button
                onClick={handleCopyPrompt}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  copied
                    ? 'bg-green-100 text-green-700'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}
              >
                {copied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                    Copy AI Prompt
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Paste this prompt into Claude.ai (or another AI), add your site walkthrough transcript, then paste the resulting JSON below.
            </p>
          </div>

          {/* Step 2 */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Step 2 — Paste the JSON</p>
            <textarea
              value={json}
              onChange={e => { setJson(e.target.value); setPreview(null); setError(''); }}
              placeholder='{ "projectName": "...", "groups": [...], "items": [...] }'
              className="w-full h-36 text-xs font-mono border border-gray-300 rounded-lg px-3 py-2
                         focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleParse}
                disabled={!json.trim()}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40
                           text-white text-sm font-medium rounded-lg transition-colors"
              >
                Parse JSON
              </button>
              {error && (
                <p className="text-red-600 text-xs">{error}</p>
              )}
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">
                Preview
                {hasWarnings && (
                  <span className="ml-2 text-amber-600 text-xs font-normal">⚠ Some items not found in catalog</span>
                )}
              </p>

              {/* Header fields */}
              <div className="bg-gray-50 rounded-lg px-4 py-3 mb-3 text-sm space-y-1">
                {preview.projectName && <div><span className="text-gray-500">Project:</span> <span className="font-medium">{preview.projectName}</span></div>}
                {preview.clientName && <div><span className="text-gray-500">Client:</span> <span className="font-medium">{preview.clientName}</span></div>}
                {preview.date && <div><span className="text-gray-500">Date:</span> <span className="font-medium">{preview.date}</span></div>}
              </div>

              {/* Groups */}
              {preview.rows.filter(r => r.type === 'group').map(group => (
                <div key={group.id} className="mb-3 border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-indigo-50 px-3 py-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-indigo-800">{group.label}</span>
                    <span className="text-xs text-indigo-500">
                      {group.sqFt > 0 && `${group.sqFt} sq ft`}
                      {group.sqFt > 0 && group.linearFt > 0 && ' · '}
                      {group.linearFt > 0 && `${group.linearFt} ln ft`}
                      {group.height > 0 && ` · ${group.height}' ht`}
                    </span>
                  </div>
                  {group.items.map(item => (
                    <ItemPreviewRow key={item.id} item={item} />
                  ))}
                  {group.items.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400 italic">No items</p>
                  )}
                </div>
              ))}

              {/* Top-level items */}
              {preview.rows.filter(r => r.type === 'item').length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-100 px-3 py-2">
                    <span className="text-sm font-semibold text-gray-700">Top-level Items</span>
                  </div>
                  {preview.rows.filter(r => r.type === 'item').map(item => (
                    <ItemPreviewRow key={item.id} item={item} showQty />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!preview}
            className="flex items-center gap-2 px-5 py-2 bg-green-700 hover:bg-green-600
                       disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Import Estimate
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemPreviewRow({ item, showQty }) {
  const notFound = item.notes?.includes('[NOT FOUND IN CATALOG]');
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 border-t border-gray-100 text-xs ${notFound ? 'bg-amber-50' : ''}`}>
      <div className="flex items-center gap-1.5 min-w-0">
        {notFound
          ? <span className="text-amber-500 shrink-0">⚠</span>
          : <span className="text-green-500 shrink-0">✓</span>
        }
        <span className={`truncate ${notFound ? 'text-amber-800' : 'text-gray-700'}`}>{item.name}</span>
      </div>
      {showQty && (
        <span className="text-gray-400 shrink-0 ml-2">qty {item.quantity}</span>
      )}
    </div>
  );
}
