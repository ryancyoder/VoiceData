import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { CHECKLIST } from "@/lib/siteVisit";

/**
 * Phase 2's payoff: what the question log actually says.
 *
 * A question asked in nearly every visit, phrased the same way each time, has
 * hardened — it has earned a fixed column of its own. One asked rarely, or
 * phrased differently every time, has not. This route reports the ratio rather
 * than deciding anything; promoting a question to a column stays a human call.
 */
export async function GET() {
  const sessionsRes = await supabase
    .from("site_visit_sessions")
    .select("id", { count: "exact", head: true });
  const totalSessions = sessionsRes.error ? 0 : (sessionsRes.count ?? 0);

  const res = await supabase
    .from("site_visit_questions")
    .select("session_id, slug, question, answered, asked_at")
    .order("asked_at", { ascending: false })
    .limit(2000);
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });

  type Row = { session_id: number; slug: string; question: string; answered: boolean; asked_at: string };
  const rows = (res.data ?? []) as Row[];

  const label = new Map(CHECKLIST.map((c) => [c.slug, c.label]));

  const bySlug = new Map<
    string,
    { slug: string; label: string; asked: number; answered: number; sessions: Set<number>; phrasings: Set<string>; lastAsked: string }
  >();

  for (const r of rows) {
    let entry = bySlug.get(r.slug);
    if (!entry) {
      entry = {
        slug: r.slug,
        label: label.get(r.slug) ?? r.slug,
        asked: 0,
        answered: 0,
        sessions: new Set(),
        phrasings: new Set(),
        lastAsked: r.asked_at,
      };
      bySlug.set(r.slug, entry);
    }
    entry.asked += 1;
    if (r.answered) entry.answered += 1;
    entry.sessions.add(r.session_id);
    // Normalized so "What's the access like?" and "what's the access like"
    // count as the same phrasing rather than inflating the variance.
    entry.phrasings.add(r.question.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim());
    if (r.asked_at > entry.lastAsked) entry.lastAsked = r.asked_at;
  }

  const questions = [...bySlug.values()]
    .map((e) => ({
      slug: e.slug,
      label: e.label,
      asked: e.asked,
      answered: e.answered,
      sessions: e.sessions.size,
      // How consistently this comes up. 1.0 = asked in every visit ever run.
      session_share: totalSessions ? e.sessions.size / totalSessions : 0,
      // How consistently it is WORDED. 1 distinct phrasing across many asks is
      // the strongest signal that the question has settled.
      distinct_phrasings: e.phrasings.size,
      last_asked: e.lastAsked,
    }))
    .sort((a, b) => b.sessions - a.sessions || b.asked - a.asked);

  return NextResponse.json({ totalSessions, questions });
}
