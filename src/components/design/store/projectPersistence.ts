import { useProjectStore, SAVE_KEYS } from './useProjectStore';
import { loadProjectState } from './useCustomStampStore';
import { TOP_LEVEL_CATEGORIES } from '../engine/categoryGroups';
import type { PlanViewConfig, LightingConfig } from '../types';

// Owns loading a design project into useProjectStore and the debounced Supabase
// autosave. The five in-canvas image fields live in Storage (uploaded only when
// they change); everything else is a single `doc` jsonb. Undo/redo history is
// intentionally ephemeral and never persisted.

const PROJECTS_API = '/api/design/projects';

type ImageField = 'background' | 'planImage' | 'planSelection' | 'planEraseMask' | 'lightingPenMask';
const IMAGE_FIELDS: ImageField[] = ['background', 'planImage', 'planSelection', 'planEraseMask', 'lightingPenMask'];

// Map legacy top-level category ids to the current scheme (carried over from the
// old IndexedDB load path).
const LEGACY_TOP_LEVEL_MAP: Record<string, string> = {
  trees: 'deciduous',
  plants: 'perennials',
  surfaces: 'other',
};

// ---- image <-> data-url helpers ----

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await blobToDataUrl(await res.blob());
  } catch {
    return null;
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = /:(.*?);/.exec(dataUrl.slice(0, comma))?.[1] || 'image/png';
  const bin = atob(dataUrl.slice(comma + 1));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ---- image field access ----

type StoreState = ReturnType<typeof useProjectStore.getState>;

function readImage(state: StoreState, field: ImageField): string | null {
  switch (field) {
    case 'background': return state.backgroundImage;
    case 'planImage': return state.planView?.image ?? null;
    case 'planSelection': return state.planView?.selectionImage ?? null;
    case 'planEraseMask': return state.planView?.eraseMask ?? null;
    case 'lightingPenMask': return state.lightingConfig?.penMask ?? null;
  }
}

// The doc jsonb: all SAVE_KEYS with the image fields stripped (they go to
// Storage), so the persisted document stays small.
function buildDoc(state: StoreState): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const key of SAVE_KEYS) {
    if (key === 'backgroundImage') continue;
    doc[key] = state[key];
  }
  const planView = state.planView;
  doc.planView = { ...planView, image: null, selectionImage: null, eraseMask: null };
  const lighting = state.lightingConfig;
  doc.lightingConfig = { ...lighting, penMask: null };
  return doc;
}

// ---- lifecycle ----

let currentProjectId: string | null = null;
let loading = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

// Per-field cache of the last base64 known to be persisted, so autosave only
// re-uploads an image when it actually changes.
const savedImages: Record<ImageField, string | null> = {
  background: null,
  planImage: null,
  planSelection: null,
  planEraseMask: null,
  lightingPenMask: null,
};

let saving = false;
let dirtyDuringSave = false;

export async function initProject(projectId: string): Promise<void> {
  teardownProject();
  loading = true;
  currentProjectId = projectId;
  for (const f of IMAGE_FIELDS) savedImages[f] = null;

  // Reset the data fields to their defaults so a previously-open project can't
  // bleed into this one, without disturbing the store's action functions.
  const initial = useProjectStore.getInitialState() as unknown as Record<string, unknown>;
  const reset: Record<string, unknown> = { selectedStampId: null, selectedLightId: null, history: [], historyIndex: -1 };
  for (const key of SAVE_KEYS) reset[key] = initial[key];
  useProjectStore.setState(reset);

  try {
    const res = await fetch(`${PROJECTS_API}/${projectId}`);
    if (res.ok) {
      const { project } = (await res.json()) as {
        project: { doc: Record<string, unknown>; images: Record<ImageField, string | null> };
      };
      const doc = project.doc ?? {};

      const updates: Record<string, unknown> = {};
      for (const key of SAVE_KEYS) {
        if (key === 'backgroundImage') continue;
        if (doc[key] !== undefined) updates[key] = doc[key];
      }

      // Legacy top-level category id migration.
      if (typeof updates.activeTopCategory === 'string' && LEGACY_TOP_LEVEL_MAP[updates.activeTopCategory]) {
        updates.activeTopCategory = LEGACY_TOP_LEVEL_MAP[updates.activeTopCategory];
      }
      if (updates.activeTopCategory && !TOP_LEVEL_CATEGORIES.find((t) => t.id === updates.activeTopCategory)) {
        delete updates.activeTopCategory;
      }

      // Resolve image fields from Storage back into base64 data URLs.
      const [bg, planImage, planSelection, planEraseMask, penMask] = await Promise.all([
        project.images.background ? urlToDataUrl(project.images.background) : Promise.resolve(null),
        project.images.planImage ? urlToDataUrl(project.images.planImage) : Promise.resolve(null),
        project.images.planSelection ? urlToDataUrl(project.images.planSelection) : Promise.resolve(null),
        project.images.planEraseMask ? urlToDataUrl(project.images.planEraseMask) : Promise.resolve(null),
        project.images.lightingPenMask ? urlToDataUrl(project.images.lightingPenMask) : Promise.resolve(null),
      ]);

      updates.backgroundImage = bg;
      const planViewDoc = (doc.planView as Partial<PlanViewConfig>) ?? {};
      updates.planView = { ...planViewDoc, image: planImage, selectionImage: planSelection, eraseMask: planEraseMask };
      const lightingDoc = (doc.lightingConfig as Partial<LightingConfig>) ?? {};
      updates.lightingConfig = { ...lightingDoc, penMask };

      // Seed the saved-image cache so the first autosave doesn't re-upload what
      // we just downloaded.
      savedImages.background = bg;
      savedImages.planImage = planImage;
      savedImages.planSelection = planSelection;
      savedImages.planEraseMask = planEraseMask;
      savedImages.lightingPenMask = penMask;

      useProjectStore.setState(updates);
    } else {
      console.warn('Failed to load design project', projectId);
    }
  } catch {
    console.warn('Failed to load design project', projectId);
  } finally {
    loading = false;
    unsubscribe = useProjectStore.subscribe(scheduleSave);
  }
}

export function teardownProject(): void {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  currentProjectId = null;
  loading = false;
}

function scheduleSave(): void {
  if (loading || !currentProjectId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist(), 1000);
}

// ---- one-time migration of the legacy single IndexedDB project ----

const LEGACY_MIGRATED_FLAG = 'pp-legacy-project-migrated';

const LEGACY_IMAGE_READERS: Record<ImageField, (s: Record<string, unknown>) => string | null> = {
  background: (s) => (s.backgroundImage as string | null) ?? null,
  planImage: (s) => ((s.planView as PlanViewConfig | undefined)?.image) ?? null,
  planSelection: (s) => ((s.planView as PlanViewConfig | undefined)?.selectionImage) ?? null,
  planEraseMask: (s) => ((s.planView as PlanViewConfig | undefined)?.eraseMask) ?? null,
  lightingPenMask: (s) => ((s.lightingConfig as LightingConfig | undefined)?.penMask) ?? null,
};

// If the design list is empty and this browser still holds a design in the old
// single-project IndexedDB store, lift it into Supabase once. Best-effort:
// returns the new project id, or null if there was nothing to migrate. Guarded
// by a localStorage flag so it can't create duplicates.
export async function migrateLegacyProjectIfAny(): Promise<string | null> {
  try {
    if (localStorage.getItem(LEGACY_MIGRATED_FLAG)) return null;
    const legacy = await loadProjectState();
    if (!legacy) return null;
    const hasContent =
      !!legacy.backgroundImage ||
      (Array.isArray(legacy.stamps) && legacy.stamps.length > 0) ||
      (Array.isArray(legacy.planStamps) && legacy.planStamps.length > 0);
    if (!hasContent) {
      localStorage.setItem(LEGACY_MIGRATED_FLAG, '1');
      return null;
    }

    // Build the doc (non-image SAVE_KEYS, plan/lighting images stripped).
    const doc: Record<string, unknown> = {};
    for (const key of SAVE_KEYS) {
      if (key === 'backgroundImage') continue;
      if (legacy[key] !== undefined) doc[key] = legacy[key];
    }
    if (doc.planView) doc.planView = { ...(doc.planView as PlanViewConfig), image: null, selectionImage: null, eraseMask: null };
    if (doc.lightingConfig) doc.lightingConfig = { ...(doc.lightingConfig as LightingConfig), penMask: null };

    const res = await fetch(PROJECTS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Recovered design', doc }),
    });
    if (!res.ok) return null;
    const { project } = (await res.json()) as { project: { id: string } };
    const pid = project.id;

    // Upload whatever images the legacy project had.
    for (const field of IMAGE_FIELDS) {
      const dataUrl = LEGACY_IMAGE_READERS[field](legacy);
      if (!dataUrl) continue;
      try {
        const form = new FormData();
        form.append('field', field);
        form.append('file', dataUrlToBlob(dataUrl), `${field}.png`);
        await fetch(`${PROJECTS_API}/${pid}/image`, { method: 'POST', body: form });
      } catch {
        console.warn('Failed to migrate legacy design image', field);
      }
    }

    localStorage.setItem(LEGACY_MIGRATED_FLAG, '1');
    return pid;
  } catch {
    return null;
  }
}

async function persist(): Promise<void> {
  const pid = currentProjectId;
  if (!pid) return;
  if (saving) { dirtyDuringSave = true; return; }
  saving = true;
  dirtyDuringSave = false;

  try {
    const state = useProjectStore.getState();

    // 1) Images: upload/clear only the fields that changed since last save.
    for (const field of IMAGE_FIELDS) {
      const cur = readImage(state, field);
      if (cur === savedImages[field]) continue;
      try {
        if (cur == null) {
          await fetch(`${PROJECTS_API}/${pid}/image?field=${field}`, { method: 'DELETE' });
        } else {
          const form = new FormData();
          form.append('field', field);
          form.append('file', dataUrlToBlob(cur), `${field}.png`);
          const r = await fetch(`${PROJECTS_API}/${pid}/image`, { method: 'POST', body: form });
          if (!r.ok) throw new Error('image upload failed');
        }
        savedImages[field] = cur;
      } catch {
        console.warn('Failed to persist design image', field);
      }
    }

    // 2) The doc (everything non-image). Never sends deal/property links.
    try {
      const doc = buildDoc(state);
      await fetch(`${PROJECTS_API}/${pid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc }),
      });
    } catch {
      console.warn('Failed to persist design doc');
    }
  } finally {
    saving = false;
    if (dirtyDuringSave) scheduleSave();
  }
}
