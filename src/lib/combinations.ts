// A "combination" is a single photo showing several plants growing together.
// It links to one or more reference plants (cultivars) and then appears inside
// the species album of every plant it's linked to. Images live in the same
// public `plant-images` bucket as plant covers (resolved via plantImageUrl),
// stored as a bare `combo-<uuid>.<ext>` filename.

// A plant as embedded in a combination (a slim projection of public.plants).
export interface CombinationPlant {
  id: number;
  botanical: string | null;
  common: string | null;
  genus: string | null;
  species: string | null;
  image: string | null;
}

export interface Combination {
  id: string;
  title: string | null;
  notes: string | null;
  image: string | null;
  created_at: string;
  updated_at: string;
  plants: CombinationPlant[];
}

export interface CombinationsResult {
  combinations: Combination[];
}
