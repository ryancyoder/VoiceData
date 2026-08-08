import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { PlacedStamp, PerspectiveConfig, ToolMode, HistoryEntry, ViewMode, PlanViewConfig, Point2D, CustomSubcategory, LightSource, LightingConfig, LightPreset } from '../types';
import { createDefaultPerspective } from '../engine/perspective';
import { TOP_LEVEL_CATEGORIES } from '../engine/categoryGroups';
import { saveProjectState, loadProjectState, usePlanSymbolStore } from './useCustomStampStore';

interface ProjectState {
  // Background
  backgroundImage: string | null;
  backgroundWidth: number;
  backgroundHeight: number;
  backgroundSaturation: number; // 0 (full B&W) to 1 (normal color)
  backgroundOpacity: number;    // 0 (invisible) to 1 (fully opaque)
  backgroundBrightness: number; // -1 (dark) to 0 (normal) to 1 (bright)
  backgroundContrast: number;   // -1 (flat) to 0 (normal) to 1 (high)

  // Canvas
  canvasWidth: number;
  canvasHeight: number;
  stageScale: number;
  stageX: number;
  stageY: number;

  // Perspective
  perspective: PerspectiveConfig;

  // Stamps (perspective view)
  stamps: PlacedStamp[];
  // Plan stamps (plan view — separate coordinate space)
  planStamps: PlacedStamp[];
  selectedStampId: string | null;
  pendingStampAssetId: string | null;

  // Tool
  toolMode: ToolMode;
  moveOnly: boolean;

  // View
  viewMode: ViewMode;
  planView: PlanViewConfig;
  planPixelsPerFoot: number | null;
  clusterMode: boolean;

  // Lighting
  lightingConfig: LightingConfig;
  selectedLightId: string | null;
  pendingLightType: LightPreset | null;

  // Sidebar
  sidebarCollapsed: boolean;
  activeCategory: string;
  activeTopCategory: string;
  activeSidebarTab: string;

  // User-created custom subcategories (nested under a top-level group)
  customSubcategories: CustomSubcategory[];

  // Properties tray
  propertiesTrayOpen: boolean;

  // History (undo/redo)
  history: HistoryEntry[];
  historyIndex: number;

  // Actions
  setBackgroundImage: (dataUrl: string, width: number, height: number) => void;
  setBackgroundSaturation: (value: number) => void;
  setBackgroundOpacity: (value: number) => void;
  setBackgroundBrightness: (value: number) => void;
  setBackgroundContrast: (value: number) => void;
  setCanvasSize: (width: number, height: number) => void;
  setStageTransform: (scale: number, x: number, y: number) => void;
  setPerspective: (update: Partial<PerspectiveConfig>) => void;
  setHorizonY: (y: number) => void;

  addStamp: (assetId: string, x: number, y: number) => void;
  addPlanStamp: (assetId: string, x: number, y: number) => void;
  updatePlanStamp: (id: string, update: Partial<PlacedStamp>) => void;
  removePlanStamp: (id: string) => void;
  updateStamp: (id: string, update: Partial<PlacedStamp>) => void;
  removeStamp: (id: string) => void;
  selectStamp: (id: string | null) => void;
  duplicateStamp: (id: string) => void;
  duplicatePlanStamp: (id: string) => void;
  setPendingStamp: (assetId: string | null) => void;

  setToolMode: (mode: ToolMode) => void;
  setMoveOnly: (on: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setPlanPixelsPerFoot: (ppf: number | null) => void;
  setClusterMode: (on: boolean) => void;
  setPlanImage: (dataUrl: string, width: number, height: number) => void;
  setPlanSelection: (dataUrl: string, width: number, height: number) => void;
  setPlanCorners: (corners: [Point2D, Point2D, Point2D, Point2D]) => void;
  setPlanOpacity: (opacity: number) => void;
  setPlanVisible: (visible: boolean) => void;
  setPlanEraseMask: (mask: string | null) => void;
  flattenOverlay: (compositeDataUrl: string) => void;
  toggleSidebar: () => void;
  setActiveCategory: (cat: string) => void;
  setActiveTopCategory: (top: string) => void;
  setActiveSidebarTab: (tab: string) => void;
  setPropertiesTrayOpen: (open: boolean) => void;

  addCustomSubcategory: (topLevel: string, label: string) => string;
  removeCustomSubcategory: (id: string) => void;
  renameCustomSubcategory: (id: string, label: string) => void;

  // Lighting actions
  addLight: (x: number, y: number, type: LightPreset) => void;
  updateLight: (id: string, update: Partial<LightSource>) => void;
  removeLight: (id: string) => void;
  selectLight: (id: string | null) => void;
  duplicateLight: (id: string) => void;
  setLightingOverlay: (color: string, opacity: number) => void;
  setPendingLightType: (type: LightPreset | null) => void;
  setLightingPenMask: (mask: string | null) => void;
  setLightingPenBrushSize: (size: number) => void;
  clearLightingPenMask: () => void;

  undo: () => void;
  redo: () => void;
  pushHistory: () => void;

  exportCanvas: () => void;
}

const MAX_HISTORY = 50;

export const useProjectStore = create<ProjectState>((set, get) => ({
  backgroundImage: null,
  backgroundWidth: 0,
  backgroundHeight: 0,
  backgroundSaturation: 1,
  backgroundOpacity: 1,
  backgroundBrightness: 0,
  backgroundContrast: 0,
  canvasWidth: 1024,
  canvasHeight: 768,
  stageScale: 1,
  stageX: 0,
  stageY: 0,

  perspective: createDefaultPerspective(1024, 768),
  stamps: [],
  planStamps: [],
  selectedStampId: null,
  pendingStampAssetId: null,
  toolMode: 'select',
  moveOnly: false,
  viewMode: 'photo',
  planPixelsPerFoot: null,
  clusterMode: false,
  lightingConfig: {
    lights: [],
    overlayColor: 'rgba(40, 0, 80, 0.6)',
    overlayOpacity: 0.6,
    penMask: null,
    penBrushSize: 30,
  },
  selectedLightId: null,
  pendingLightType: null,
  planView: {
    image: null,
    imageWidth: 0,
    imageHeight: 0,
    selectionImage: null,
    selectionWidth: 0,
    selectionHeight: 0,
    corners: null,
    opacity: 0.6,
    eraseMask: null,
    visible: true,
  },
  sidebarCollapsed: false,
  activeCategory: 'shade-trees',
  activeTopCategory: 'deciduous',
  activeSidebarTab: 'objects',
  customSubcategories: [],
  propertiesTrayOpen: false,

  history: [],
  historyIndex: -1,

  setBackgroundImage: (dataUrl, width, height) => {
    const perspective = createDefaultPerspective(width, height);
    set({
      backgroundImage: dataUrl,
      backgroundWidth: width,
      backgroundHeight: height,
      perspective,
      stamps: [],
      selectedStampId: null,
      toolMode: 'horizon' as const,
      history: [],
      historyIndex: -1,
    });
  },

  setBackgroundSaturation: (value) => set({ backgroundSaturation: value }),
  setBackgroundOpacity: (value) => set({ backgroundOpacity: value }),
  setBackgroundBrightness: (value) => set({ backgroundBrightness: value }),
  setBackgroundContrast: (value) => set({ backgroundContrast: value }),

  setCanvasSize: (width, height) => set({ canvasWidth: width, canvasHeight: height }),

  setStageTransform: (scale, x, y) => set({ stageScale: scale, stageX: x, stageY: y }),

  setPerspective: (update) =>
    set((state) => ({
      perspective: { ...state.perspective, ...update },
    })),

  setHorizonY: (y) =>
    set((state) => ({
      perspective: { ...state.perspective, horizonY: y },
    })),

  addStamp: (assetId, x, y) => {
    get().pushHistory();
    const stamp: PlacedStamp = {
      id: uuid(),
      assetId,
      x,
      y,
      manualScale: 1,
      rotation: 0,
      flipX: false,
      opacity: 1,
      zIndex: get().stamps.length,
    };
    set((state) => ({
      stamps: [...state.stamps, stamp],
      selectedStampId: stamp.id,
      pendingStampAssetId: null,
      propertiesTrayOpen: true,
    }));
  },

  addPlanStamp: (assetId, x, y) => {
    // Use the symbol's locked-in defaultScale if set
    const sym = usePlanSymbolStore.getState().getSymbol(assetId);
    const defaultScale = sym?.defaultScale ?? 1;
    const stamp: PlacedStamp = {
      id: uuid(),
      assetId,
      x,
      y,
      manualScale: defaultScale,
      rotation: 0,
      flipX: false,
      opacity: 1,
      zIndex: get().planStamps.length,
    };
    set((state) => ({
      planStamps: [...state.planStamps, stamp],
      selectedStampId: stamp.id,
      pendingStampAssetId: null,
    }));
  },

  updatePlanStamp: (id, update) =>
    set((state) => ({
      planStamps: state.planStamps.map((s) => (s.id === id ? { ...s, ...update } : s)),
    })),

  removePlanStamp: (id) =>
    set((state) => ({
      planStamps: state.planStamps.filter((s) => s.id !== id),
      selectedStampId: state.selectedStampId === id ? null : state.selectedStampId,
    })),

  updateStamp: (id, update) =>
    set((state) => ({
      stamps: state.stamps.map((s) => (s.id === id ? { ...s, ...update } : s)),
    })),

  removeStamp: (id) => {
    get().pushHistory();
    set((state) => ({
      stamps: state.stamps.filter((s) => s.id !== id),
      selectedStampId: state.selectedStampId === id ? null : state.selectedStampId,
      propertiesTrayOpen: state.selectedStampId === id ? false : state.propertiesTrayOpen,
    }));
  },

  selectStamp: (id) =>
    set({
      selectedStampId: id,
      propertiesTrayOpen: id !== null,
    }),

  duplicateStamp: (id) => {
    const stamp = get().stamps.find((s) => s.id === id);
    if (!stamp) return;
    get().pushHistory();
    const newStamp: PlacedStamp = {
      ...stamp,
      id: uuid(),
      x: stamp.x + 30,
      y: stamp.y + 30,
      zIndex: get().stamps.length,
    };
    set((state) => ({
      stamps: [...state.stamps, newStamp],
      selectedStampId: newStamp.id,
    }));
  },

  duplicatePlanStamp: (id) => {
    const stamp = get().planStamps.find((s) => s.id === id);
    if (!stamp) return;
    const newStamp: PlacedStamp = {
      ...stamp,
      id: uuid(),
      x: stamp.x + 30,
      y: stamp.y + 30,
      zIndex: get().planStamps.length,
    };
    set((state) => ({
      planStamps: [...state.planStamps, newStamp],
      selectedStampId: newStamp.id,
    }));
  },

  setPendingStamp: (assetId) => set({ pendingStampAssetId: assetId, selectedStampId: null }),

  setToolMode: (mode) => set({ toolMode: mode, selectedStampId: null, pendingStampAssetId: null }),
  setMoveOnly: (on) => set({ moveOnly: on, pendingStampAssetId: null }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setPlanPixelsPerFoot: (ppf) => set({ planPixelsPerFoot: ppf }),
  setClusterMode: (on) => set({ clusterMode: on }),

  setPlanImage: (dataUrl, width, height) =>
    set((state) => ({
      planView: {
        ...state.planView,
        image: dataUrl,
        imageWidth: width,
        imageHeight: height,
        selectionImage: null,
        selectionWidth: 0,
        selectionHeight: 0,
        corners: null,
        eraseMask: null,
      },
    })),

  setPlanSelection: (dataUrl, width, height) => {
    const bgW = get().backgroundWidth || 1024;
    const bgH = get().backgroundHeight || 768;
    const cx = bgW / 2;
    const cy = bgH / 2;
    // Size the initial overlay to ~25% of the photo
    const hw = Math.min(bgW, bgH) * 0.2;
    const hh = hw * (height / width);
    const corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh },
    ];
    set((state) => ({
      planView: {
        ...state.planView,
        selectionImage: dataUrl,
        selectionWidth: width,
        selectionHeight: height,
        corners,
        eraseMask: null,
      },
      viewMode: 'photo' as const,
    }));
  },

  setPlanCorners: (corners) =>
    set((state) => ({
      planView: { ...state.planView, corners },
    })),

  setPlanOpacity: (opacity) =>
    set((state) => ({
      planView: { ...state.planView, opacity },
    })),

  setPlanVisible: (visible) =>
    set((state) => ({
      planView: { ...state.planView, visible },
    })),

  setPlanEraseMask: (mask) =>
    set((state) => ({
      planView: { ...state.planView, eraseMask: mask },
    })),

  flattenOverlay: (compositeDataUrl) =>
    set((state) => ({
      backgroundImage: compositeDataUrl,
      planView: {
        ...state.planView,
        selectionImage: null,
        selectionWidth: 0,
        selectionHeight: 0,
        corners: null,
        eraseMask: null,
      },
    })),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setActiveCategory: (cat) => set({ activeCategory: cat }),
  setActiveTopCategory: (top) => {
    const group = TOP_LEVEL_CATEGORIES.find((t) => t.id === top);
    if (!group) return;
    // Pick the first available subcategory (built-in, falling back to custom)
    const customForTop = get().customSubcategories.filter((c) => c.topLevel === top).map((c) => c.id);
    const firstSub = group.subcategories[0] ?? customForTop[0];
    if (!firstSub) return;
    // Surfaces (textures) uses the 'textures' sidebar tab
    const isTextures = firstSub === 'textures';
    set({
      activeTopCategory: top,
      activeCategory: firstSub,
      activeSidebarTab: isTextures ? 'textures' : 'objects',
    });
  },
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  setPropertiesTrayOpen: (open) => set({ propertiesTrayOpen: open }),

  addCustomSubcategory: (topLevel, label) => {
    const trimmed = label.trim();
    if (!trimmed) return '';
    const id = `custom-sub-${uuid()}`;
    const sub: CustomSubcategory = { id, label: trimmed, topLevel };
    set((state) => ({
      customSubcategories: [...state.customSubcategories, sub],
      // Switch to the newly created subcategory
      activeTopCategory: topLevel,
      activeCategory: id,
      activeSidebarTab: 'objects',
    }));
    return id;
  },

  removeCustomSubcategory: (id) =>
    set((state) => {
      const remaining = state.customSubcategories.filter((c) => c.id !== id);
      // If the deleted one was active, fall back to the top-level's first subcategory
      let activeCategory = state.activeCategory;
      if (state.activeCategory === id) {
        const top = TOP_LEVEL_CATEGORIES.find((t) => t.id === state.activeTopCategory);
        const customForTop = remaining.filter((c) => c.topLevel === state.activeTopCategory).map((c) => c.id);
        activeCategory = (top?.subcategories[0] ?? customForTop[0]) as string;
      }
      return { customSubcategories: remaining, activeCategory };
    }),

  renameCustomSubcategory: (id, label) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    set((state) => ({
      customSubcategories: state.customSubcategories.map((c) =>
        c.id === id ? { ...c, label: trimmed } : c
      ),
    }));
  },

  // ---- Lighting actions ----

  addLight: (x, y, type) => {
    const presets: Record<string, Partial<LightSource>> = {
      uplight:   { radius: 120, intensity: 0.8, spreadX: 0.6, spreadY: 1.8, color: 'warm', beamAngle: 60, distance: 200 },
      path:      { radius: 80,  intensity: 0.7, spreadX: 1.0, spreadY: 1.0, color: 'warm', beamAngle: 360, distance: 80 },
      spotlight: { radius: 150, intensity: 0.85, spreadX: 0.7, spreadY: 1.2, color: 'warm', beamAngle: 45, distance: 250 },
    };
    const defaults = presets[type] ?? presets.path;
    const light: LightSource = {
      id: uuid(),
      x, y, type,
      radius: defaults.radius ?? 120,
      intensity: defaults.intensity ?? 0.8,
      color: defaults.color ?? 'warm',
      rotation: 0,
      spreadX: defaults.spreadX ?? 1.0,
      spreadY: defaults.spreadY ?? 1.0,
      beamAngle: defaults.beamAngle ?? 360,
      distance: defaults.distance ?? 120,
    };
    set((state) => ({
      lightingConfig: {
        ...state.lightingConfig,
        lights: [...state.lightingConfig.lights, light],
      },
      selectedLightId: light.id,
    }));
  },

  updateLight: (id, update) =>
    set((state) => ({
      lightingConfig: {
        ...state.lightingConfig,
        lights: state.lightingConfig.lights.map((l) =>
          l.id === id ? { ...l, ...update } : l
        ),
      },
    })),

  removeLight: (id) =>
    set((state) => ({
      lightingConfig: {
        ...state.lightingConfig,
        lights: state.lightingConfig.lights.filter((l) => l.id !== id),
      },
      selectedLightId: state.selectedLightId === id ? null : state.selectedLightId,
    })),

  selectLight: (id) => set({ selectedLightId: id }),

  duplicateLight: (id) => {
    const light = get().lightingConfig.lights.find((l) => l.id === id);
    if (!light) return;
    const newLight: LightSource = {
      ...light,
      id: uuid(),
      x: Math.min(1, light.x + 0.03),
      y: Math.min(1, light.y + 0.03),
    };
    set((state) => ({
      lightingConfig: {
        ...state.lightingConfig,
        lights: [...state.lightingConfig.lights, newLight],
      },
      selectedLightId: newLight.id,
    }));
  },

  setLightingOverlay: (color, opacity) =>
    set((state) => ({
      lightingConfig: {
        ...state.lightingConfig,
        overlayColor: color,
        overlayOpacity: opacity,
      },
    })),

  setPendingLightType: (type) => set({ pendingLightType: type }),

  setLightingPenMask: (mask) =>
    set((state) => ({
      lightingConfig: { ...state.lightingConfig, penMask: mask },
    })),

  setLightingPenBrushSize: (size) =>
    set((state) => ({
      lightingConfig: { ...state.lightingConfig, penBrushSize: size },
    })),

  clearLightingPenMask: () =>
    set((state) => ({
      lightingConfig: { ...state.lightingConfig, penMask: null },
    })),

  pushHistory: () =>
    set((state) => {
      const entry: HistoryEntry = {
        stamps: JSON.parse(JSON.stringify(state.stamps)),
        perspective: { ...state.perspective },
      };
      const newHistory = state.history.slice(0, state.historyIndex + 1);
      newHistory.push(entry);
      if (newHistory.length > MAX_HISTORY) newHistory.shift();
      return { history: newHistory, historyIndex: newHistory.length - 1 };
    }),

  undo: () =>
    set((state) => {
      if (state.historyIndex < 0) return state;
      const entry = state.history[state.historyIndex];
      return {
        stamps: JSON.parse(JSON.stringify(entry.stamps)),
        perspective: { ...entry.perspective },
        historyIndex: state.historyIndex - 1,
        selectedStampId: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state;
      const entry = state.history[state.historyIndex + 1];
      return {
        stamps: JSON.parse(JSON.stringify(entry.stamps)),
        perspective: { ...entry.perspective },
        historyIndex: state.historyIndex + 1,
        selectedStampId: null,
      };
    }),

  exportCanvas: () => {
    // This is triggered from the component that has access to the Konva stage ref
    // The actual export logic lives in EditorCanvas
  },
}));

// ---- Auto-save project state to IndexedDB ----

const SAVE_KEYS = [
  'backgroundImage', 'backgroundWidth', 'backgroundHeight',
  'backgroundSaturation', 'backgroundOpacity', 'backgroundBrightness', 'backgroundContrast',
  'perspective', 'stamps', 'planStamps', 'planView', 'planPixelsPerFoot', 'clusterMode',
  'lightingConfig',
  'customSubcategories', 'activeTopCategory', 'activeCategory',
] as const;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

useProjectStore.subscribe((state) => {
  // Debounce saves to avoid thrashing during drag
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const toSave: Record<string, any> = {};
    for (const key of SAVE_KEYS) {
      toSave[key] = state[key];
    }
    saveProjectState(toSave);
  }, 1000);
});

// ---- Auto-load on startup ----

// Map legacy top-level category ids ('trees'/'plants'/'surfaces') to the new scheme
const LEGACY_TOP_LEVEL_MAP: Record<string, string> = {
  trees: 'deciduous',
  plants: 'perennials',
  surfaces: 'other',
};

loadProjectState().then((saved) => {
  if (!saved) return;
  const updates: Record<string, any> = {};
  for (const key of SAVE_KEYS) {
    if (saved[key] !== undefined) {
      updates[key] = saved[key];
    }
  }
  // Migrate legacy top-level category ids to the new scheme
  if (typeof updates.activeTopCategory === 'string' && LEGACY_TOP_LEVEL_MAP[updates.activeTopCategory]) {
    updates.activeTopCategory = LEGACY_TOP_LEVEL_MAP[updates.activeTopCategory];
  }
  if (!TOP_LEVEL_CATEGORIES.find((t) => t.id === updates.activeTopCategory)) {
    // Unknown top-level id → drop it so default is used
    delete updates.activeTopCategory;
  }
  if (Object.keys(updates).length > 0) {
    useProjectStore.setState(updates);
  }
});
