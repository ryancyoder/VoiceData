// Catalog item photos live in a public Storage bucket; each row keeps the
// object path. Mirrors the deal-photos / estimate-plans helpers.
export const CATALOG_PHOTOS_BUCKET = "catalog-photos";

export function catalogPhotoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${CATALOG_PHOTOS_BUCKET}/${storagePath}`;
}

export interface CatalogPhoto {
  id: string;
  url: string;
  is_cover: boolean;
}
