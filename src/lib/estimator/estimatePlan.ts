// Plan images for estimates live in a public Storage bucket; the estimate row
// keeps only the object path (plan_image_path). Mirrors the deal-photos helpers
// in salesBoard.ts.
export const ESTIMATE_PLANS_BUCKET = "estimate-plans";

export function planImageUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${ESTIMATE_PLANS_BUCKET}/${storagePath}`;
}
