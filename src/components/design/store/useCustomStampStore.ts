import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { CustomStamp, StampCategory, PlantMeta } from '../types';

const DB_NAME = 'perspectivephoto';
const DB_VERSION = 3;
const STORE_NAME = 'custom-stamps';
const PLAN_STORE_NAME = 'plan-symbols';
const PROJECT_STORE_NAME = 'project-state';

const LIBRARY_API = '/api/design/library';

type LibraryKind = 'perspective-stamp' | 'plan-symbol';

// ---- IndexedDB (project-state persistence + one-time library migration) ----
//
// Phase 2 moves the two stamp libraries to Supabase (pp_library_items +
// pp-library bucket). The active project blob still lives in IndexedDB here
// (that migration is Phase 3), so openDB and the project-state helpers stay.
// The library object stores are only touched now to migrate any stamps a user
// built while the app was still IndexedDB-only.

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PLAN_STORE_NAME)) {
        db.createObjectStore(PLAN_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PROJECT_STORE_NAME)) {
        db.createObjectStore(PROJECT_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(storeName: string): Promise<CustomStamp[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve((req.result as CustomStamp[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function idbClear(storeName: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* silent */ }
}

// ---- Image <-> Storage helpers ----

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Fetch a public Storage URL and inline it as a base64 data URL, so the rest of
// the app keeps treating stamp.dataUrl as a data URL (thumbnails, and — via the
// crossOrigin canvas paths — an untainted export). Falls back to the raw URL if
// the fetch fails.
async function urlToDataUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    return await blobToDataUrl(await res.blob());
  } catch {
    return url;
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mime = /:(.*?);/.exec(header)?.[1] || 'image/png';
  const bin = atob(dataUrl.slice(comma + 1));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// The jsonb `data` document is a CustomStamp minus its id and image bytes.
function stampToData(stamp: CustomStamp): Record<string, unknown> {
  const { id, dataUrl, ...data } = stamp;
  void id;
  void dataUrl;
  return data;
}

// ---- Library API ----

interface LibraryRow {
  id: string;
  kind: LibraryKind;
  data: Record<string, unknown>;
  image_path: string | null;
  imageUrl: string | null;
}

async function apiListLibrary(): Promise<LibraryRow[]> {
  try {
    const res = await fetch(LIBRARY_API);
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: LibraryRow[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

// Create a library row: upload the image and persist the metadata. Fire-and-
// forget from the caller's perspective (matching the app's optimistic UI), but
// awaitable for the migration path.
async function apiCreateLibraryItem(
  kind: LibraryKind,
  stamp: CustomStamp,
  file: Blob,
  fileName: string,
): Promise<boolean> {
  try {
    const form = new FormData();
    form.append('file', file, fileName);
    form.append('id', stamp.id);
    form.append('kind', kind);
    form.append('data', JSON.stringify(stampToData(stamp)));
    const res = await fetch(LIBRARY_API, { method: 'POST', body: form });
    if (!res.ok) {
      console.warn('Failed to save library item to Supabase');
      return false;
    }
    return true;
  } catch {
    console.warn('Failed to save library item to Supabase');
    return false;
  }
}

function apiUpdateLibraryItem(stamp: CustomStamp): void {
  fetch(`${LIBRARY_API}/${encodeURIComponent(stamp.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: stampToData(stamp) }),
  }).catch(() => console.warn('Failed to update library item'));
}

function apiDeleteLibraryItem(id: string): void {
  fetch(`${LIBRARY_API}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() =>
    console.warn('Failed to delete library item'),
  );
}

// Load one library kind from Supabase, converting Storage URLs back to data
// URLs. On first run, migrates any pre-existing IndexedDB stamps up to Supabase.
async function loadLibraryKind(kind: LibraryKind, idbStore: string): Promise<CustomStamp[]> {
  const rows = (await apiListLibrary()).filter((r) => r.kind === kind);

  if (rows.length === 0) {
    const legacy = await idbGetAll(idbStore);
    if (legacy.length > 0) {
      let migrated = 0;
      for (const s of legacy) {
        const stamp: CustomStamp = { ...s, category: s.category || 'custom' };
        if (!stamp.dataUrl) continue;
        const ok = await apiCreateLibraryItem(kind, stamp, dataUrlToBlob(stamp.dataUrl), `${stamp.id}.png`);
        if (ok) migrated++;
      }
      // Only clear the local copy once everything made it up.
      if (migrated === legacy.filter((s) => s.dataUrl).length) {
        await idbClear(idbStore);
      }
      return legacy.map((s) => ({ ...s, category: s.category || 'custom' }));
    }
    return [];
  }

  return Promise.all(
    rows.map(async (row) => {
      const d = row.data as Partial<CustomStamp>;
      return {
        id: row.id,
        name: d.name || 'Stamp',
        category: (d.category as StampCategory) || 'custom',
        dataUrl: row.imageUrl ? await urlToDataUrl(row.imageUrl) : '',
        naturalWidth: d.naturalWidth || 100,
        naturalHeight: d.naturalHeight || 100,
        createdAt: d.createdAt || Date.now(),
        defaultScale: d.defaultScale,
        botanicalName: d.botanicalName,
        commonName: d.commonName,
        notes: d.notes,
      } as CustomStamp;
    }),
  );
}

// Read an image File into a CustomStamp shell (dataUrl + natural dimensions).
function fileToStampBase(file: File): Promise<{ dataUrl: string; naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File must be an image'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => resolve({ dataUrl, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// ---- Custom stamp store (perspective view) ----

interface CustomStampLibrary {
  stamps: CustomStamp[];
  loaded: boolean;
  loadStamps: () => Promise<void>;
  addStampWithCategory: (file: File, category: StampCategory) => Promise<string>;
  addStampFromDataUrl: (name: string, dataUrl: string, width: number, height: number, category?: StampCategory) => string;
  removeStamp: (id: string) => void;
  renameStamp: (id: string, name: string) => void;
  updateStampMeta: (id: string, meta: PlantMeta) => void;
  getStamp: (id: string) => CustomStamp | undefined;
  exportLibrary: () => void;
  importLibrary: () => void;
}

export const useCustomStampStore = create<CustomStampLibrary>((set, get) => ({
  stamps: [],
  loaded: false,

  loadStamps: async () => {
    if (get().loaded) return;
    const stamps = await loadLibraryKind('perspective-stamp', STORE_NAME);
    set({ stamps, loaded: true });
  },

  addStampWithCategory: async (file, category) => {
    const { dataUrl, naturalWidth, naturalHeight } = await fileToStampBase(file);
    const stamp: CustomStamp = {
      id: `custom-${uuid()}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      category,
      dataUrl,
      naturalWidth,
      naturalHeight,
      createdAt: Date.now(),
    };
    set((state) => ({ stamps: [...state.stamps, stamp] }));
    void apiCreateLibraryItem('perspective-stamp', stamp, file, file.name);
    return stamp.id;
  },

  addStampFromDataUrl: (name, dataUrl, width, height, category = 'custom') => {
    const stamp: CustomStamp = {
      id: `custom-${uuid()}`,
      name,
      category,
      dataUrl,
      naturalWidth: width,
      naturalHeight: height,
      createdAt: Date.now(),
    };
    set((state) => ({ stamps: [...state.stamps, stamp] }));
    void apiCreateLibraryItem('perspective-stamp', stamp, dataUrlToBlob(dataUrl), `${stamp.id}.png`);
    return stamp.id;
  },

  removeStamp: (id) => {
    set((state) => ({ stamps: state.stamps.filter((s) => s.id !== id) }));
    apiDeleteLibraryItem(id);
  },

  renameStamp: (id, name) => {
    set((state) => ({
      stamps: state.stamps.map((s) => (s.id === id ? { ...s, name } : s)),
    }));
    const stamp = get().stamps.find((s) => s.id === id);
    if (stamp) apiUpdateLibraryItem(stamp);
  },

  updateStampMeta: (id, meta) => {
    set((state) => ({
      stamps: state.stamps.map((s) => (s.id === id ? { ...s, ...meta } : s)),
    }));
    const stamp = get().stamps.find((s) => s.id === id);
    if (stamp) apiUpdateLibraryItem(stamp);
  },

  getStamp: (id) => get().stamps.find((s) => s.id === id),

  exportLibrary: () => {
    const stamps = get().stamps;
    if (stamps.length === 0) return;
    const json = JSON.stringify(stamps);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'perspectivephoto-library.json';
    link.click();
    URL.revokeObjectURL(url);
  },

  importLibrary: () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const stamps: CustomStamp[] = JSON.parse(ev.target?.result as string);
          if (!Array.isArray(stamps)) return;
          for (const stamp of stamps) {
            if (!stamp.id || !stamp.dataUrl) continue;
            if (get().stamps.find((s) => s.id === stamp.id)) continue;
            const s: CustomStamp = {
              id: stamp.id,
              name: stamp.name || 'Imported',
              category: stamp.category || 'custom',
              dataUrl: stamp.dataUrl,
              naturalWidth: stamp.naturalWidth || 100,
              naturalHeight: stamp.naturalHeight || 100,
              createdAt: stamp.createdAt || Date.now(),
            };
            set((state) => ({ stamps: [...state.stamps, s] }));
            void apiCreateLibraryItem('perspective-stamp', s, dataUrlToBlob(s.dataUrl), `${s.id}.png`);
          }
        } catch {
          console.warn('Failed to import library');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },
}));

// Auto-load on import (client-only; the design tree is loaded via ssr:false).
useCustomStampStore.getState().loadStamps();

// ---- Project State Persistence (still IndexedDB in Phase 2) ----

export async function saveProjectState(state: Record<string, unknown>): Promise<void> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORE_NAME, 'readwrite');
      tx.objectStore(PROJECT_STORE_NAME).put(state, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* silent */ }
}

export async function loadProjectState(): Promise<Record<string, unknown> | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECT_STORE_NAME, 'readonly');
      const req = tx.objectStore(PROJECT_STORE_NAME).get('current');
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

// ---- Plan Symbols store (2D plan view symbols, same shape, separate kind) ----

interface PlanSymbolLibrary {
  symbols: CustomStamp[];
  loaded: boolean;
  loadSymbols: () => Promise<void>;
  addSymbolWithCategory: (file: File, category: StampCategory) => Promise<string>;
  addSymbolFromDataUrl: (name: string, dataUrl: string, width: number, height: number, category?: StampCategory) => string;
  removeSymbol: (id: string) => void;
  updateSymbolMeta: (id: string, meta: PlantMeta) => void;
  getSymbol: (id: string) => CustomStamp | undefined;
  setSymbolDefaultScale: (id: string, scale: number) => void;
  exportLibrary: () => void;
  importLibrary: () => void;
}

export const usePlanSymbolStore = create<PlanSymbolLibrary>((set, get) => ({
  symbols: [],
  loaded: false,

  loadSymbols: async () => {
    if (get().loaded) return;
    const symbols = await loadLibraryKind('plan-symbol', PLAN_STORE_NAME);
    set({ symbols, loaded: true });
  },

  addSymbolWithCategory: async (file, category) => {
    const { dataUrl, naturalWidth, naturalHeight } = await fileToStampBase(file);
    const sym: CustomStamp = {
      id: `plan-${uuid()}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      category,
      dataUrl,
      naturalWidth,
      naturalHeight,
      createdAt: Date.now(),
    };
    set((state) => ({ symbols: [...state.symbols, sym] }));
    void apiCreateLibraryItem('plan-symbol', sym, file, file.name);
    return sym.id;
  },

  addSymbolFromDataUrl: (name, dataUrl, width, height, category = 'custom') => {
    const sym: CustomStamp = {
      id: `plan-${uuid()}`,
      name,
      category,
      dataUrl,
      naturalWidth: width,
      naturalHeight: height,
      createdAt: Date.now(),
    };
    set((state) => ({ symbols: [...state.symbols, sym] }));
    void apiCreateLibraryItem('plan-symbol', sym, dataUrlToBlob(dataUrl), `${sym.id}.png`);
    return sym.id;
  },

  removeSymbol: (id) => {
    set((state) => ({ symbols: state.symbols.filter((s) => s.id !== id) }));
    apiDeleteLibraryItem(id);
  },

  updateSymbolMeta: (id, meta) => {
    set((state) => ({
      symbols: state.symbols.map((s) => (s.id === id ? { ...s, ...meta } : s)),
    }));
    const sym = get().symbols.find((s) => s.id === id);
    if (sym) apiUpdateLibraryItem(sym);
  },

  getSymbol: (id) => get().symbols.find((s) => s.id === id),

  setSymbolDefaultScale: (id, scale) => {
    set((state) => ({
      symbols: state.symbols.map((s) => (s.id === id ? { ...s, defaultScale: scale } : s)),
    }));
    const sym = get().symbols.find((s) => s.id === id);
    if (sym) apiUpdateLibraryItem(sym);
  },

  exportLibrary: () => {
    const symbols = get().symbols;
    if (symbols.length === 0) return;
    const blob = new Blob([JSON.stringify(symbols)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'perspectivephoto-plan-symbols.json';
    link.click();
    URL.revokeObjectURL(url);
  },

  importLibrary: () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const symbols: CustomStamp[] = JSON.parse(ev.target?.result as string);
          if (!Array.isArray(symbols)) return;
          for (const sym of symbols) {
            if (!sym.id || !sym.dataUrl) continue;
            if (get().symbols.find((s) => s.id === sym.id)) continue;
            const s: CustomStamp = {
              id: sym.id,
              name: sym.name || 'Imported',
              category: sym.category || 'custom',
              dataUrl: sym.dataUrl,
              naturalWidth: sym.naturalWidth || 100,
              naturalHeight: sym.naturalHeight || 100,
              createdAt: sym.createdAt || Date.now(),
            };
            set((state) => ({ symbols: [...state.symbols, s] }));
            void apiCreateLibraryItem('plan-symbol', s, dataUrlToBlob(s.dataUrl), `${s.id}.png`);
          }
        } catch {
          console.warn('Failed to import plan symbols');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },
}));

usePlanSymbolStore.getState().loadSymbols();
