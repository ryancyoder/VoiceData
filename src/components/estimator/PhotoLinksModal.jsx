'use client';

import { useCallback, useEffect, useState } from 'react';
import { dealPhotoUrl } from '@/lib/salesBoard';

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

// The live take-off dimensions of the group, overlaid on a linked photo.
function DimsOverlay({ group }) {
  const parts = [];
  if (group.sqFt) parts.push(`${fmt(group.sqFt)} sq ft`);
  if (group.linearFt) parts.push(`${fmt(group.linearFt)} ln ft`);
  if (group.height) parts.push(`${fmt(group.height)} ft H`);
  if (parts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex flex-wrap gap-1">
      {parts.map((p, i) => (
        <span key={i} className="rounded bg-black/70 px-1.5 py-0.5 text-[0.65rem] font-semibold text-white">
          {p}
        </span>
      ))}
    </div>
  );
}

export default function PhotoLinksModal({ estimateId, group, onClose, onChanged }) {
  const [links, setLinks] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lr, cr] = await Promise.all([
        fetch(`/api/estimator/estimates/${estimateId}/photo-links`).then((r) => r.json()),
        fetch(`/api/estimator/estimates/${estimateId}/candidate-photos`).then((r) => r.json()),
      ]);
      setLinks(Array.isArray(lr.links) ? lr.links : []);
      setCandidates(Array.isArray(cr.photos) ? cr.photos : []);
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }, [estimateId]);

  useEffect(() => {
    load();
  }, [load]);

  const groupLinks = links.filter((l) => l.group_id === group.id);
  const linkedIds = new Set(groupLinks.map((l) => l.photo_id));
  const attachable = candidates.filter((p) => !linkedIds.has(p.id));

  async function attach(photoId) {
    setBusyId(photoId);
    try {
      const res = await fetch(`/api/estimator/estimates/${estimateId}/photo-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, photoId }),
      });
      if (res.ok) {
        await load();
        onChanged?.();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function detach(link) {
    setBusyId(link.photo_id);
    try {
      const res = await fetch(`/api/estimator/estimates/${estimateId}/photo-links`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId: link.id }),
      });
      if (res.ok) {
        await load();
        onChanged?.();
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Linked photos</h2>
            <p className="text-xs text-gray-500">{group.label || 'Take-off group'}</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-700" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading…</div>
          ) : (
            <>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Linked ({groupLinks.length})</h3>
              {groupLinks.length === 0 ? (
                <p className="mb-6 text-sm text-gray-400">No photos linked to this take-off group yet.</p>
              ) : (
                <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {groupLinks.map((link) => {
                    const p = link.deal_photos;
                    return (
                      <div key={link.id} className="relative overflow-hidden rounded-lg border border-gray-200">
                        {p && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={dealPhotoUrl(p.storage_path)} alt={p.caption || ''} className="aspect-square w-full object-cover" />
                        )}
                        <DimsOverlay group={group} />
                        <button
                          onClick={() => detach(link)}
                          disabled={busyId === link.photo_id}
                          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white disabled:opacity-50"
                          aria-label="Unlink photo"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Attach a photo</h3>
              {attachable.length === 0 ? (
                <p className="text-sm text-gray-400">No other photos found for this deal / property.</p>
              ) : (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {attachable.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => attach(p.id)}
                      disabled={busyId === p.id}
                      className="group relative overflow-hidden rounded-lg border border-gray-200 hover:ring-2 hover:ring-indigo-400 disabled:opacity-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={dealPhotoUrl(p.storage_path)} alt={p.caption || ''} className="aspect-square w-full object-cover" />
                      {p.original_storage_path && (
                        <span className="absolute left-1 top-1 rounded bg-indigo-600 px-1 py-0.5 text-[0.55rem] font-semibold text-white">✎ marked</span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[0.6rem] font-medium text-white">+ Link</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
