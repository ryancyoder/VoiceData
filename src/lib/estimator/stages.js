// Production phases for the estimator. The DB `sequence_stages` table is the
// source of truth for which phases exist and their order (loaded via
// usePhases / /api/estimator/phases). CANONICAL_STAGES here is only a fallback
// used when that fetch fails, and it mirrors the seeded sequence.
export const CANONICAL_STAGES = [
  'demolition', 'excavation', 'patio', 'bed_installation', 'outcropping',
  'planting', 'mulching', 'lawn_install', 'cleanup',
];

// Optional prettier display names; anything not listed falls back to a
// title-cased version of the stage name.
const STAGE_LABEL_OVERRIDES = {
  bed_installation: 'Bed Install',
  patio: 'Patio / Hardscape',
  lawn_install: 'Lawn',
};

export function stageLabel(name) {
  if (!name) return '';
  return STAGE_LABEL_OVERRIDES[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
