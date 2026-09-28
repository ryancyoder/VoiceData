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

export type ImageScope = "cultivar" | "species" | "genus" | "unknown";

// A stand-in photo must say so. The catalog spent a long time with one photo per
// genus quietly standing in for every cultivar under it — `Rosa.jpeg` on
// twenty-three different roses — and the damage was not the substitution but the
// silence: nothing on the card distinguished a portrait from a placeholder.
// Returns null when the photo really is of this plant, or when there is no claim
// to check.
export function standInLabel(
  scope: ImageScope | null | undefined,
  cultivar: string | null | undefined,
): { short: string; full: string } | null {
  if (!cultivar || !cultivar.trim()) return null;   // a species row may use a species photo
  if (!scope || scope === "cultivar") return null;
  if (scope === "species") {
    return { short: "species photo", full: "This is a photo of the species, not of this cultivar." };
  }
  if (scope === "genus") {
    return { short: "genus photo", full: "This is a photo of the genus, not of this cultivar." };
  }
  return { short: "unverified", full: "Nobody has checked whether this photo is this cultivar." };
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
  // What the photo on this row actually depicts. A named cultivar whose scope is
  // "species" or "genus" is wearing a stand-in: the right plant could not be found,
  // so a relative is shown instead. Null means the row has never been audited.
  image_scope: ImageScope | null;
  // Which supplier the photo came from ("provenwinners", "openverse", …), and when
  // it was last checked. Null for the original vault import.
  image_source: string | null;
  image_verified_at: string | null;
  // One cultivar per species can be starred as the "choice" — its photo becomes
  // the species album cover and it represents the group.
  is_choice: boolean | null;
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

// A species "album" — cultivars of one genus+species collapsed into one entry.
export interface PlantAlbum {
  album_key: string;
  genus: string | null;
  species: string | null;
  common: string | null;
  category: string | null;
  cultivars: number;
  image: string | null;
  // The scope of the cover photo. An album cover is one member's photo standing for
  // the group, so "genus" here means the cover is not even of a plant in this album.
  image_scope: ImageScope | null;
}

export interface PlantAlbumsResult {
  albums: PlantAlbum[];
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
