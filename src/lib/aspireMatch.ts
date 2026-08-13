// Fuzzy matching between an RLM master material name and Aspire catalog item
// names. Token-based (Dice coefficient on normalized words) with a containment
// bonus, so "Hardwood Mulch" scores high against "Mulch - Hardwood (per cy)".

const STOPWORDS = new Set(["per", "each", "ea", "the", "of", "and", "with", "for", "to"]);

export function normalizeName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/["'”“]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(
    normalizeName(s)
      .split(" ")
      .filter((t) => t && !STOPWORDS.has(t)),
  );
}

// 0..1 similarity. Blends token Dice overlap with a containment bonus (one
// normalized name fully inside the other), which catches vendor prefixes/suffixes.
export function scoreMatch(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = tokenSet(a);
  const tb = tokenSet(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const dice = ta.size + tb.size ? (2 * inter) / (ta.size + tb.size) : 0;

  // Containment: shorter name appearing whole inside the longer one.
  let contain = 0;
  const [shortN, longN] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (longN.includes(shortN)) contain = 0.6 + 0.4 * (shortN.length / longN.length);

  return Math.max(dice, contain);
}

export interface AspireCandidate {
  item_name: string;
  category_name?: string | null;
  item_type?: string | null;
  purchase_unit_type?: string | null;
  item_cost?: number | null;
}

export interface ScoredCandidate extends AspireCandidate {
  score: number;
}

// Top-N Aspire candidates for a material name, best first, above a floor.
export function bestMatches(name: string, items: AspireCandidate[], topN = 5, floor = 0.15): ScoredCandidate[] {
  const scored: ScoredCandidate[] = [];
  for (const it of items) {
    const score = scoreMatch(name, it.item_name);
    if (score >= floor) scored.push({ ...it, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
