// The design (PerspectivePhoto) stamp/plan-symbol library lives in Supabase:
// one row per library item in public.pp_library_items, with the PNG in the
// public `pp-library` Storage bucket referenced by image_path. Mirrors the
// deal-photos / estimate-plans / catalog-photos helpers.
export const PP_LIBRARY_BUCKET = "pp-library";

export function ppLibraryUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${PP_LIBRARY_BUCKET}/${storagePath}`;
}

// Which of the two libraries a row belongs to.
export type LibraryKind = "perspective-stamp" | "plan-symbol";

export const LIBRARY_KINDS: LibraryKind[] = ["perspective-stamp", "plan-symbol"];

export function isLibraryKind(v: unknown): v is LibraryKind {
  return v === "perspective-stamp" || v === "plan-symbol";
}

// The jsonb `data` document: everything about a CustomStamp EXCEPT the image
// bytes, which move to Storage (image_path). Shapes mirror CustomStamp in the
// design types, minus dataUrl.
export interface LibraryItemData {
  name: string;
  category: string;
  naturalWidth: number;
  naturalHeight: number;
  createdAt: number;
  defaultScale?: number;
  botanicalName?: string;
  commonName?: string;
  notes?: string;
  // Optional link to a public.plants reference entry (id + a display name
  // snapshot so the library can show it without a join).
  referencePlantId?: number;
  referencePlantName?: string;
}

// A row as returned by the library API. imageUrl is the public URL derived from
// image_path; the client converts it to a base64 data URL so the rest of the
// app keeps treating stamp.dataUrl as a data URL (and canvas export stays
// untainted).
export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  data: LibraryItemData;
  image_path: string | null;
  imageUrl: string | null;
}
