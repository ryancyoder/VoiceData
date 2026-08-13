import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

// Replace the Aspire catalog reference table with a fresh export. The client
// parses the Aspire CSV and posts the rows; we dedupe by item_name (keep last),
// wipe the table, and bulk-insert — so the table always mirrors the latest
// export (the "source of truth, updated at times").

interface InRow {
  item_name?: string;
  category_name?: string | null;
  item_type?: string | null;
  purchase_unit_type?: string | null;
  item_cost?: number | string | null;
  item_code?: string | null;
  active?: boolean | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

export async function POST(req: NextRequest) {
  let body: { rows?: InRow[] };
  try {
    body = (await req.json()) as { rows?: InRow[] };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return NextResponse.json({ error: "no rows to import" }, { status: 400 });

  // Dedupe by item_name (keep the last occurrence), drop blanks.
  const byName = new Map<string, InRow>();
  for (const r of rows) {
    const name = (r.item_name ?? "").toString().trim();
    if (name) byName.set(name, r);
  }
  const clean = [...byName.values()].map((r) => ({
    item_name: (r.item_name ?? "").toString().trim(),
    category_name: str(r.category_name),
    item_type: str(r.item_type),
    purchase_unit_type: str(r.purchase_unit_type),
    item_cost: num(r.item_cost),
    item_code: str(r.item_code),
    active: r.active === false ? false : true,
  }));

  // Wipe, then bulk-insert in chunks. (Full replace keeps it an exact mirror,
  // so items removed in Aspire disappear here too.)
  const del = await supabase.from("aspire_catalog").delete().gt("id", 0);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });

  const CHUNK = 500;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const ins = await supabase.from("aspire_catalog").insert(clean.slice(i, i + CHUNK));
    if (ins.error) return NextResponse.json({ error: ins.error.message, imported: i }, { status: 500 });
  }

  return NextResponse.json({ imported: clean.length });
}
