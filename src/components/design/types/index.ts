export type BuiltInStampCategory = 'shade-trees' | 'evergreens' | 'ornamental-trees' | 'columnar' | 'grasses' | 'shrubs' | 'perennials' | 'ground-cover' | 'textures' | 'custom';
/** Either a built-in category id or a user-created custom subcategory id */
export type StampCategory = BuiltInStampCategory | string;

/** User-created subcategory nested under a top-level group */
export interface CustomSubcategory {
  id: string;
  label: string;
  topLevel: string;
}

export type ToolMode = 'select' | 'horizon' | 'calibrate' | 'eraser' | 'objEraser' | 'pan' | 'placeLight' | 'lightPen';

export interface CalibrationRef {
  x: number;           // position of the reference person
  y: number;           // bottom (feet) Y position
  heightPx: number;    // how tall the person silhouette is in pixels at this position
  realHeightFt: number; // real-world height (default 5.75 ft / ~5'9")
}

export interface PerspectiveConfig {
  horizonY: number;
  groundY: number;
  vanishingPointX: number;
  baseScale: number;
  calibration: CalibrationRef | null;
}

export interface StampAsset {
  id: string;
  name: string;
  category: StampCategory;
  svgPath: string;
  colors: string[];
  defaultWidth: number;
  defaultHeight: number;
}

/** User-uploaded custom stamp (PNG image stored as data URL) */
export interface CustomStamp {
  id: string;
  name: string;
  category: StampCategory;
  dataUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  createdAt: number;
  defaultScale?: number;  // locked-in default manualScale for plan view placement

  // Plant metadata (user-editable)
  botanicalName?: string;
  commonName?: string;
  notes?: string;
}

/** The editable metadata fields on a CustomStamp */
export interface PlantMeta {
  name?: string;
  botanicalName?: string;
  commonName?: string;
  category?: StampCategory;
  notes?: string;
}

export interface PlacedStamp {
  id: string;
  assetId: string;
  x: number;
  y: number;
  manualScale: number;
  rotation: number;
  flipX: boolean;
  opacity: number;
  zIndex: number;
}

export interface Project {
  id: string;
  name: string;
  backgroundImage: string | null;
  backgroundWidth: number;
  backgroundHeight: number;
  perspective: PerspectiveConfig;
  stamps: PlacedStamp[];
  canvasWidth: number;
  canvasHeight: number;
}

export interface HistoryEntry {
  stamps: PlacedStamp[];
  perspective: PerspectiveConfig;
}

export type ViewMode = 'photo' | 'plan' | 'lighting';

// ---- Lighting System ----

export type LightPreset = 'uplight' | 'path' | 'spotlight';

export interface LightSource {
  id: string;
  x: number;           // 0-1 normalized (fraction of backgroundWidth)
  y: number;           // 0-1 normalized (fraction of backgroundHeight)
  type: LightPreset;
  radius: number;      // pixel radius at native image resolution
  intensity: number;   // 0-1, controls gradient alpha
  color: string;       // 'warm' | 'cool' | hex color
  rotation: number;    // degrees
  spreadX: number;     // horizontal stretch multiplier
  spreadY: number;     // vertical stretch multiplier
  beamAngle: number;   // cone beam width in degrees (20-180)
  distance: number;    // cone reach in pixels from source
}

export interface LightingConfig {
  lights: LightSource[];
  overlayColor: string;    // e.g. 'rgba(40, 0, 80, 0.6)'
  overlayOpacity: number;  // 0-1
  penMask: string | null;  // data URL of freehand reveal strokes
  penBrushSize: number;    // brush radius in image pixels
}

/** 2D point */
export interface Point2D {
  x: number;
  y: number;
}

/** Plan overlay: uploaded plan image warped onto the perspective photo via 4 corners */
export interface PlanViewConfig {
  image: string | null;       // data URL of the full uploaded plan image
  imageWidth: number;
  imageHeight: number;
  // Cropped selection from the plan — this is what gets warped
  selectionImage: string | null;  // data URL of the cropped selection
  selectionWidth: number;
  selectionHeight: number;
  // 4 corner positions on the perspective photo where the selection maps to
  corners: [Point2D, Point2D, Point2D, Point2D] | null;
  opacity: number;
  eraseMask: string | null;
  visible: boolean;
}
