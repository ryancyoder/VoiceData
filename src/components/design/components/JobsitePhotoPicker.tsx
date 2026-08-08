import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useProjectStore } from '../store/useProjectStore';

interface DealPhoto {
  id: number;
  url: string;
  caption: string | null;
}

// Pick a background from the jobsite photos already attached to this design's
// deal/property. The chosen photo is inlined to a data URL and set as the
// background (the autosave then copies it into the design's own Storage), so
// the canvas export stays untainted — no component change to the canvas.
export function JobsitePhotoPicker({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [photos, setPhotos] = useState<DealPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const setBackgroundImage = useProjectStore((s) => s.setBackgroundImage);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/design/projects/${projectId}/deal-photos`);
        const data = res.ok ? await res.json() : { photos: [] };
        if (active) setPhotos(data.photos ?? []);
      } catch {
        if (active) setPhotos([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  const pick = async (photo: DealPhoto) => {
    setBusyId(photo.id);
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error('load failed'));
        img.src = dataUrl;
      });
      setBackgroundImage(dataUrl, dims.w, dims.h);
      onClose();
    } catch {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Use a jobsite photo</h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100" title="Close">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-12 text-center text-sm text-gray-400">Loading photos…</p>
          ) : photos.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-400">
              No jobsite photos on this deal yet.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  onClick={() => pick(photo)}
                  disabled={busyId !== null}
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-gray-200 bg-gray-100 disabled:opacity-60"
                  title={photo.caption ?? 'Use as background'}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={photo.caption ?? ''}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                  {busyId === photo.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-gray-700">
                      Loading…
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
