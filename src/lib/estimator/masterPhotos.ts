// Photos for the master-catalog entities (materials, assemblies, equipment)
// live in a public Storage bucket; each master_photos row keeps the object
// path. Mirrors the catalog-photos helper, but polymorphic across entity types.
export const MASTER_PHOTOS_BUCKET = "master-photos";

export type MasterEntityType = "material" | "assembly" | "equipment";

export function masterPhotoUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${MASTER_PHOTOS_BUCKET}/${storagePath}`;
}

export interface MasterPhoto {
  id: string;
  url: string;
  is_cover: boolean;
}

// Map key used to group photos by owner in API payloads: "material:pulverized_topsoil".
export function photoKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}
