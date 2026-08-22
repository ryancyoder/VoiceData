import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { listTables } from "@/lib/tableBrowser";

// Row counts for the table browser's sidebar. Fetched separately from the
// schema (and after it, by the client) because this is one HEAD request per
// table — useful, but not worth blocking the first paint on. A table whose
// count can't be read (a view PostgREST won't count, say) comes back as null
// rather than failing the whole response.
const CONCURRENCY = 8;

export async function GET() {
  let tables;
  try {
    tables = await listTables();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const counts: Record<string, number | null> = {};
  const names = tables.map((t) => t.name);
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= names.length) return;
      const name = names[i];
      const { count, error } = await supabase
        .from(name)
        .select("*", { count: "exact", head: true });
      counts[name] = error ? null : (count ?? null);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker));

  return NextResponse.json({ counts });
}
