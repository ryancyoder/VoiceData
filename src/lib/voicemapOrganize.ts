// "Suggested home" logic: find loose, unfiled cards (root-level captures with no
// children) and suggest the established topic they're semantically closest to,
// using the gte-small node embeddings. Pure + deterministic so it can be
// unit-tested; the /voicemap/organize page feeds it rows from Supabase.

export interface OrgNode {
  id: string;
  parent_id: string | null;
  session_id: string;
  label: string | null;
  summary: string | null;
  archived: boolean;
  embedding: number[] | null;
}

export interface HomeSuggestion {
  card: { id: string; session_id: string; label: string; summary: string };
  suggestions: { topic_id: string; topic_label: string; score: number }[];
}

// pgvector selects come back as the text form "[a,b,c]"; accept that or an array.
export function parseEmbedding(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? (arr as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
function norm(a: number[]): number[] {
  const m = Math.sqrt(dot(a, a)) || 1;
  return a.map((x) => x / m);
}

// Root ancestor of a node (cycle-guarded).
function rootOf(id: string, parent: Map<string, string | null>, ids: Set<string>): string {
  let cur = id;
  const seen = new Set<string>();
  for (;;) {
    const p = parent.get(cur);
    if (!p || !ids.has(p) || seen.has(p)) break;
    seen.add(p);
    cur = p;
  }
  return cur;
}

export function suggestHomes(nodes: OrgNode[], opts: { perCard?: number } = {}): HomeSuggestion[] {
  const perCard = opts.perCard ?? 3;

  const ids = new Set(nodes.map((n) => n.id));
  const parent = new Map<string, string | null>();
  const childCount = new Map<string, number>();
  for (const n of nodes) {
    parent.set(n.id, n.parent_id);
    if (n.parent_id && ids.has(n.parent_id)) childCount.set(n.parent_id, (childCount.get(n.parent_id) ?? 0) + 1);
  }

  const isRoot = (n: OrgNode) => !n.parent_id || !ids.has(n.parent_id);
  const rootByNode = new Map<string, string>();
  for (const n of nodes) rootByNode.set(n.id, rootOf(n.id, parent, ids));

  // Established topics = non-archived root cards that have children. Their vector
  // is the (normalized) mean embedding of all embedded cards in their subtree.
  const topicSum = new Map<string, { vec: number[]; count: number; label: string; session: string }>();
  for (const n of nodes) {
    if (n.archived || !n.embedding) continue;
    const topicId = rootByNode.get(n.id)!;
    const topicNode = nodes.find((t) => t.id === topicId);
    if (!topicNode || topicNode.archived || isRootLeaf(topicNode)) continue; // topic must be a real (parented) topic
    const cur = topicSum.get(topicId);
    if (!cur) {
      topicSum.set(topicId, {
        vec: [...n.embedding],
        count: 1,
        label: topicNode.label ?? "(untitled)",
        session: topicNode.session_id,
      });
    } else {
      for (let i = 0; i < cur.vec.length; i++) cur.vec[i] += n.embedding[i];
      cur.count += 1;
    }
  }
  function isRootLeaf(n: OrgNode): boolean {
    return isRoot(n) && !(childCount.get(n.id) ?? 0);
  }

  const topics = [...topicSum.entries()].map(([id, t]) => ({
    id,
    label: t.label,
    session: t.session,
    vec: norm(t.vec),
  }));
  if (!topics.length) return [];

  // Unfiled = non-archived root leaf cards with an embedding.
  const out: HomeSuggestion[] = [];
  for (const n of nodes) {
    if (n.archived || !n.embedding || !isRootLeaf(n)) continue;
    const cv = norm(n.embedding);
    const scored = topics
      .filter((t) => t.session === n.session_id) // suggest within the same session
      .map((t) => ({ topic_id: t.id, topic_label: t.label, score: dot(cv, t.vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, perCard);
    if (!scored.length) continue;
    out.push({
      card: { id: n.id, session_id: n.session_id, label: n.label ?? "(untitled)", summary: n.summary ?? "" },
      suggestions: scored,
    });
  }

  // Most confident suggestions first.
  out.sort((a, b) => (b.suggestions[0]?.score ?? 0) - (a.suggestions[0]?.score ?? 0));
  return out;
}
