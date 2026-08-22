import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { supabase } from "@/lib/supabaseClient";
import { resolveChecklist, type ChecklistState, type SiteVisitSession, type SiteVisitTurn } from "@/lib/siteVisit";
import { loadSiteVisitContext } from "@/lib/siteVisitContext";
import { renderBrief } from "@/lib/siteVisit";

// Shared session plumbing for the /api/site-visit routes.

export const SESSION_COLUMNS = "id, deal_id, property_id, tile_key, status, turns, summary, started_at, ended_at";

export async function fetchSession(id: number): Promise<SiteVisitSession | null> {
  const { data, error } = await supabase
    .from("site_visit_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return normalizeSession(data);
}

export function normalizeSession(row: unknown): SiteVisitSession {
  const r = row as SiteVisitSession & { turns: unknown };
  return { ...r, turns: Array.isArray(r.turns) ? (r.turns as SiteVisitTurn[]) : [] };
}

/**
 * Rebuild the model's history from the stored turns. Only the text survives —
 * tool_use blocks are deliberately dropped, because the record of what those
 * tools wrote comes back on every turn as a freshly resolved checklist. The
 * database is the memory; the transcript is just the conversation.
 */
export function historyFromTurns(turns: SiteVisitTurn[], nextUserText?: string): MessageParam[] {
  const messages: MessageParam[] = turns
    .filter((t) => t.content.trim())
    .map((t) => ({ role: t.role, content: t.content }));
  if (nextUserText?.trim()) messages.push({ role: "user", content: nextUserText.trim() });
  return messages;
}

export async function appendTurns(sessionId: number, existing: SiteVisitTurn[], added: SiteVisitTurn[]): Promise<void> {
  const turns = [...existing, ...added];
  const { error } = await supabase.from("site_visit_sessions").update({ turns }).eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export interface SessionView {
  session: SiteVisitSession;
  brief: string;
  checklist: ChecklistState[];
  context: Awaited<ReturnType<typeof loadSiteVisitContext>>;
}

/** Load a session together with its deal's current context and checklist. */
export async function loadSessionView(session: SiteVisitSession): Promise<SessionView> {
  const context = await loadSiteVisitContext(session.deal_id);
  const checklist = resolveChecklist(context);
  return { session, brief: renderBrief(context, checklist), checklist, context };
}

/** The visible transcript — the synthetic kickoff turn is history, not dialog. */
export function visibleTurns(turns: SiteVisitTurn[]): SiteVisitTurn[] {
  return turns.filter((t) => !t.hidden);
}
