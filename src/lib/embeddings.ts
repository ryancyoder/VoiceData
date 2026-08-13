import OpenAI from "openai";

// Text embeddings via OpenAI (reuses OPENAI_API_KEY, already used for Whisper).
// text-embedding-3-small is 1536 dims — matches the vector(1536) columns.
const EMBED_MODEL = "text-embedding-3-small";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI();
  return client;
}

// OpenAI caps embedding input size; truncate defensively by characters (a loose
// proxy for tokens) so a very long article never trips the API limit.
const MAX_CHARS = 24000;

export async function embedText(text: string): Promise<number[]> {
  const input = (text || "").slice(0, MAX_CHARS).trim() || "(empty)";
  const res = await getClient().embeddings.create({ model: EMBED_MODEL, input });
  return res.data[0].embedding as number[];
}

// pgvector accepts its text input form `[a,b,c]`; send this as the column value
// (PostgREST casts text -> vector on assignment).
export function toVectorLiteral(embedding: number[]): string {
  return "[" + embedding.join(",") + "]";
}
