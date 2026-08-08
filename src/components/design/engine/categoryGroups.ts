import type { StampCategory, CustomSubcategory } from '../types';

export interface TopLevelCategory {
  id: string;
  label: string;
  subcategories: StampCategory[];
}

/**
 * Top-level category groupings. Each contains a set of built-in subcategories.
 * Users can also add their own custom subcategories under any top-level via
 * `customSubcategories` in the project store, which get merged at read time.
 */
export const TOP_LEVEL_CATEGORIES: TopLevelCategory[] = [
  {
    id: 'deciduous',
    label: 'Deciduous',
    subcategories: ['shade-trees', 'ornamental-trees'],
  },
  {
    id: 'evergreens',
    label: 'Evergreens',
    subcategories: ['evergreens', 'columnar'],
  },
  {
    id: 'grasses',
    label: 'Grasses',
    subcategories: ['grasses'],
  },
  {
    id: 'shrubs',
    label: 'Shrubs',
    subcategories: ['shrubs'],
  },
  {
    id: 'perennials',
    label: 'Perennials',
    subcategories: ['perennials', 'ground-cover'],
  },
  {
    id: 'other',
    label: 'Other',
    subcategories: ['textures'],
  },
];

/** Find the top-level category that contains a given subcategory (built-in or custom) */
export function getTopLevelForCategory(
  category: string,
  customSubs: CustomSubcategory[] = []
): TopLevelCategory {
  const custom = customSubs.find((c) => c.id === category);
  if (custom) {
    const found = TOP_LEVEL_CATEGORIES.find((t) => t.id === custom.topLevel);
    if (found) return found;
  }
  const found = TOP_LEVEL_CATEGORIES.find((t) => t.subcategories.includes(category as StampCategory));
  return found ?? TOP_LEVEL_CATEGORIES[0];
}

/** Built-in sub-category labels for display */
export const SUB_CATEGORY_LABELS: Record<string, string> = {
  'shade-trees': 'Shade Trees',
  'evergreens': 'Evergreens',
  'ornamental-trees': 'Ornamental',
  'columnar': 'Columnar',
  'grasses': 'Grasses',
  'shrubs': 'Shrubs',
  'perennials': 'Perennials',
  'ground-cover': 'Ground Cover',
  'textures': 'Surfaces',
};

/** Resolve a subcategory id to a display label, falling back to a custom subcategory label or a titled id */
export function getSubcategoryLabel(id: string, customSubs: CustomSubcategory[] = []): string {
  if (SUB_CATEGORY_LABELS[id]) return SUB_CATEGORY_LABELS[id];
  const custom = customSubs.find((c) => c.id === id);
  if (custom) return custom.label;
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Merged list of subcategory ids (built-in + custom) for a given top-level, in display order */
export function getSubcategoriesForTopLevel(
  topLevelId: string,
  customSubs: CustomSubcategory[] = []
): string[] {
  const top = TOP_LEVEL_CATEGORIES.find((t) => t.id === topLevelId);
  const builtIns = top ? [...top.subcategories] : [];
  const customIds = customSubs.filter((c) => c.topLevel === topLevelId).map((c) => c.id);
  return [...builtIns, ...customIds];
}
