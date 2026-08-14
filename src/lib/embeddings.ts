// Text embeddings via Supabase's built-in gte-small model (384 dims), run in
// the `embed` Edge Function. No external embedding provider or key — it reuses
// the Supabase URL + service-role key the app already has. Used for the wiki's
// semantic "related topics".

const MAX_CHARS = 2000; // gte-small handles ~512 tokens; keep input comfortably under

function edgeConfig(): { url: string; key: string } {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !key) throw new Error("Supabase URL / key not configured");
  return { url: base.replace(/\/+$/, ""), key };
}

export async function embedText(text: string): Promise<number[]> {
  const { url, key } = edgeConfig();
  const input = (text || "").slice(0, MAX_CHARS).trim() || "(empty)";
  const res = await fetch(`${url}/functions/v1/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ text: input }),
  });
  if (!res.ok) throw new Error(`embed edge function ${res.status}`);
  const data = (await res.json()) as { embedding?: unknown };
  if (!Array.isArray(data.embedding)) throw new Error("embed edge function returned no embedding");
  return data.embedding as number[];
}

// Batch variant — embeds many texts in one edge call (used for node reindexing).
// Returns vectors in the same order as the input.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const { url, key } = edgeConfig();
  const inputs = texts.map((t) => (t || "").slice(0, MAX_CHARS).trim() || "(empty)");
  const res = await fetch(`${url}/functions/v1/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ texts: inputs }),
  });
  if (!res.ok) throw new Error(`embed edge function ${res.status}`);
  const data = (await res.json()) as { embeddings?: unknown };
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== inputs.length) {
    throw new Error("embed edge function returned wrong number of embeddings");
  }
  return data.embeddings as number[][];
}

// pgvector accepts its text input form `[a,b,c]`; send this as the column value
// (PostgREST casts text -> vector on assignment).
export function toVectorLiteral(embedding: number[]): string {
  return "[" + embedding.join(",") + "]";
}
