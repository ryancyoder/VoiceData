// Design (PerspectivePhoto) projects live in public.pp_projects; per-design
// images live in the public `pp-designs` Storage bucket, referenced by *_path
// columns. Mirrors the deal-photos / estimate-plans helpers.
export const PP_DESIGNS_BUCKET = "pp-designs";

export function ppDesignUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${PP_DESIGNS_BUCKET}/${storagePath}`;
}

// The five in-canvas image fields (plus the exported render) that move out of
// the doc jsonb into Storage, and the pp_projects column each maps to.
export const IMAGE_FIELD_COLUMNS = {
  background: "background_image_path",
  planImage: "plan_image_path",
  planSelection: "plan_selection_path",
  planEraseMask: "plan_erase_mask_path",
  lightingPenMask: "lighting_pen_mask_path",
  render: "render_path",
} as const;

export type ProjectImageField = keyof typeof IMAGE_FIELD_COLUMNS;

export const IMAGE_FIELDS = Object.keys(IMAGE_FIELD_COLUMNS) as ProjectImageField[];

export function isImageField(v: unknown): v is ProjectImageField {
  return typeof v === "string" && v in IMAGE_FIELD_COLUMNS;
}

// A row summary for the design list.
export interface ProjectSummary {
  id: string;
  name: string;
  deal_id: number | null;
  property_id: number | null;
  event_id: number | null;
  updated_at: string;
  created_at: string;
  thumbnailUrl: string | null;
}

// A full project as returned by GET /[id]: the doc jsonb plus each image field
// resolved to a public URL (null when unset).
export interface ProjectFull {
  id: string;
  name: string;
  deal_id: number | null;
  property_id: number | null;
  event_id: number | null;
  doc: Record<string, unknown>;
  images: Record<ProjectImageField, string | null>;
}
