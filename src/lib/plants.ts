// The plants reference catalog (public.plants) — a read-only horticultural
// knowledge base (from the Obsidian PLANTS vault), distinct from the design
// stamp library (pp_library_items). Multi-value fields are text[] arrays.

export const PLANT_CATEGORIES = ["Perennials", "Shrubs", "Trees", "Ground Cover", "Bulbs"] as const;
export const SUN_OPTIONS = ["Full Sun", "Part Shade", "Full Shade", "Deep Shade"] as const;
export const MOISTURE_OPTIONS = ["Low", "Average", "High"] as const;

// The plant album-cover images live in the public `plant-images` bucket, keyed
// by bare filename. plants.image is a vault path like
// "PLANTS/Plant Album Covers/Acer rubrum - Red Maple.jpeg", so the object is its
// basename. Not every referenced file has been uploaded yet — callers fall back
// to a placeholder when the image 404s.
export const PLANT_IMAGES_BUCKET = "plant-images";

export function plantImageUrl(image: string | null | undefined): string | null {
  if (!image) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const filename = image.replace(/^.*\//, "").trim();
  if (!filename) return null;
  return `${base}/storage/v1/object/public/${PLANT_IMAGES_BUCKET}/${encodeURIComponent(filename)}`;
}

export interface Plant {
  id: number;
  type: string | null;
  category: string | null;
  genus: string | null;
  species: string | null;
  cultivar: string | null;
  botanical: string | null;
  common: string | null;
  sun: string[] | null;
  soil: string[] | null;
  soil_ph: string[] | null;
  moisture: string[] | null;
  zone: string | null;
  height_in: number | null;
  width_in: number | null;
  spread_in: number | null;
  bloom_season: string[] | null;
  bloom_color: string[] | null;
  foliage_color: string[] | null;
  texture: string | null;
  form: string | null;
  growth_rate: string | null;
  native: boolean | null;
  pollinator_value: string | null;
  attracts: string[] | null;
  deer_resistant: boolean | null;
  rabbit_resistant: boolean | null;
  evergreen: boolean | null;
  seasonal_interest: string[] | null;
  matrix_role: string | null;
  design_style: string[] | null;
  features: string[] | null;
  image: string | null;
  source_url: string | null;
  last_updated: string | null;
  source_file: string | null;
}

export interface PlantQueryResult {
  plants: Plant[];
  total: number;
  page: number;
  pageSize: number;
}

// Inches → a compact feet/inches label (e.g. 26 → 2'2").
export function formatInches(inches: number | null | undefined): string {
  if (inches == null) return "—";
  if (inches < 12) return `${inches}"`;
  const ft = Math.floor(inches / 12);
  const rem = inches % 12;
  return rem ? `${ft}'${rem}"` : `${ft}'`;
}
