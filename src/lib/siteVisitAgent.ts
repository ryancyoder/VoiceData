import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { supabase } from "@/lib/supabaseClient";
import { syncDealNextActionPhoto } from "@/lib/nextActionPhoto";
import { AD_HOC_SLUG, CHECKLIST, CHECKLIST_SLUGS, gapsOf, renderBrief, type ChecklistState, type SiteVisitContext } from "@/lib/siteVisit";

// The agent side of a site-visit session: a tool-use loop whose tools all write
// back into Supabase. Every gap the conversation closes becomes a row, so the
// next tap of the tile starts from a smaller checklist.

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ITERATIONS = 8;
const DEALS_TABLE = "Sales Board";

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

/** Deal columns the agent may write. Deliberately descriptive and scheduling
 *  fields only — stage, status, and the money-in dates are moved on the board
 *  by a human, not by something overheard in a driveway. */
const WRITABLE_DEAL_FIELDS = [
  "proposal_description",
  "value",
  "appointment_date",
  "start_date",
  "end_date",
  "rfp_date",
] as const;
type WritableDealField = (typeof WRITABLE_DEAL_FIELDS)[number];

const WRITABLE_CONTACT_FIELDS = ["first_name", "last_name", "email", "phone"] as const;
type WritableContactField = (typeof WRITABLE_CONTACT_FIELDS)[number];

/** Which deal column a column-backed checklist item ends up in, so record_answer
 *  can tell the model what still needs writing through. */
const SLUG_COLUMN_HINT: Record<string, string> = {
  scope: "update_deal with proposal_description",
  value: "update_deal with value",
  schedule: "update_deal with start_date and end_date",
  contact: "update_contact",
  jobsite_address: "the address is on the property record — mention it in your reply so it can be fixed by hand",
  next_action: "set_next_action",
};

const tools: Tool[] = [
  {
    name: "record_answer",
    description:
      "Log a checklist question you asked together with the answer you got. Call this every time the client (or the user) answers something on the checklist, before moving on to the next gap.",
    input_schema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: `The checklist item this answers. One of: ${[...CHECKLIST_SLUGS].join(", ")}, or "${AD_HOC_SLUG}" for a follow-up question of your own.`,
        },
        question: { type: "string", description: "The question you actually asked, word for word." },
        answer: { type: "string", description: "The answer, in the speaker's own terms. Keep the detail." },
      },
      required: ["slug", "question", "answer"],
    },
  },
  {
    name: "log_question",
    description:
      "Log a question you asked that did NOT get an answer (skipped, deferred, or the client didn't know). Keeps the question log honest about what was actually asked.",
    input_schema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        question: { type: "string" },
      },
      required: ["slug", "question"],
    },
  },
  {
    name: "add_note",
    description:
      "Record a free-form observation that no checklist item covers — something noticed, a concern, how the client seemed. Use this generously; narration is the point.",
    input_schema: {
      type: "object",
      properties: {
        body: { type: "string" },
        slug: { type: "string", description: "Optional checklist item this relates to." },
      },
      required: ["body"],
    },
  },
  {
    name: "update_deal",
    description:
      "Write confirmed facts onto the deal record. Only send the fields you actually learned. Dates are YYYY-MM-DD. Never guess a value you were not told.",
    input_schema: {
      type: "object",
      properties: {
        proposal_description: { type: "string", description: "The scope of work in a sentence or two." },
        value: { type: "number", description: "Ballpark job value in dollars." },
        appointment_date: { type: "string", description: "YYYY-MM-DD" },
        start_date: { type: "string", description: "YYYY-MM-DD, first day on the job." },
        end_date: { type: "string", description: "YYYY-MM-DD, last day on the job." },
        rfp_date: { type: "string", description: "YYYY-MM-DD, when the proposal was requested." },
      },
    },
  },
  {
    name: "update_contact",
    description:
      "Update the property's primary contact. Only send fields you were actually given. Fails when the deal has no property or the property has no contact yet.",
    input_schema: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
      },
    },
  },
  {
    name: "set_next_action",
    description:
      "Create a task on this deal and flag it as the deal's single next action, replacing whatever held that flag before.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The next concrete thing that has to happen." },
        context: {
          type: "string",
          enum: ["Office", "Field", "Phone", "Design", "Errand", "Waiting"],
          description: "Where the task gets done.",
        },
      },
      required: ["title"],
    },
  },
];

export interface SiteVisitToolCall {
  name: string;
  input: unknown;
  result?: unknown;
  error?: string;
}

export interface SiteVisitTurnResult {
  reply: string;
  toolCalls: SiteVisitToolCall[];
  messages: MessageParam[];
}

interface ToolContext {
  sessionId: number;
  dealId: number;
  ctx: SiteVisitContext;
}

const asText = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function runTool(name: string, input: Record<string, unknown>, tc: ToolContext): Promise<unknown> {
  switch (name) {
    case "record_answer": {
      const slug = asText(input.slug) ?? AD_HOC_SLUG;
      const question = asText(input.question);
      const answer = asText(input.answer);
      if (!question) throw new Error("question is required");
      if (!answer) throw new Error("answer is required");
      const { error } = await supabase.from("site_visit_questions").insert({
        session_id: tc.sessionId,
        deal_id: tc.dealId,
        slug,
        question,
        answered: true,
        answer,
      });
      if (error) throw new Error(error.message);
      // Nudge the model to write through to the real column. Logging the answer
      // keeps the question history; it does NOT update the deal record.
      const hint = SLUG_COLUMN_HINT[slug];
      return {
        ok: true,
        logged: slug,
        next_step: hint
          ? `This item is backed by a real column — now call ${hint} so the record itself is updated.`
          : "No column backs this item yet; the logged answer is the record.",
      };
    }

    case "log_question": {
      const slug = asText(input.slug) ?? AD_HOC_SLUG;
      const question = asText(input.question);
      if (!question) throw new Error("question is required");
      const { error } = await supabase.from("site_visit_questions").insert({
        session_id: tc.sessionId,
        deal_id: tc.dealId,
        slug,
        question,
        answered: false,
      });
      if (error) throw new Error(error.message);
      return { ok: true, logged: slug, answered: false };
    }

    case "add_note": {
      const body = asText(input.body);
      if (!body) throw new Error("body is required");
      const { error } = await supabase.from("site_visit_notes").insert({
        session_id: tc.sessionId,
        deal_id: tc.dealId,
        slug: asText(input.slug),
        body,
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    case "update_deal": {
      const updates: Partial<Record<WritableDealField, string | number | null>> = {};
      for (const field of WRITABLE_DEAL_FIELDS) {
        const raw = input[field];
        if (raw === undefined || raw === null) continue;
        if (field === "value") {
          const n = typeof raw === "number" ? raw : Number(raw);
          if (!Number.isFinite(n)) throw new Error("value must be a number");
          updates.value = n;
        } else {
          const text = asText(raw);
          if (!text) continue;
          if (field !== "proposal_description" && !DATE_RE.test(text)) {
            throw new Error(`${field} must be YYYY-MM-DD`);
          }
          updates[field] = text;
        }
      }
      if (!Object.keys(updates).length) throw new Error("No writable fields supplied");
      const { error } = await supabase.from(DEALS_TABLE).update(updates).eq("id", tc.dealId);
      if (error) throw new Error(error.message);
      return { ok: true, updated: Object.keys(updates) };
    }

    case "update_contact": {
      const contactId = tc.ctx.contact?.id ?? tc.ctx.property?.primary_contact_id ?? null;
      if (contactId == null) {
        throw new Error(
          "This deal has no primary contact on its property yet — say so in your reply instead of writing it."
        );
      }
      const updates: Partial<Record<WritableContactField, string>> = {};
      for (const field of WRITABLE_CONTACT_FIELDS) {
        const text = asText(input[field]);
        if (text) updates[field] = text;
      }
      if (!Object.keys(updates).length) throw new Error("No writable fields supplied");
      const { error } = await supabase.from("contacts").update(updates).eq("id", contactId);
      if (error) throw new Error(error.message);
      return { ok: true, updated: Object.keys(updates) };
    }

    case "set_next_action": {
      const title = asText(input.title);
      if (!title) throw new Error("title is required");
      // Only one task per deal may hold the flag — clear the incumbent first so
      // this is two plain updates rather than a unique-index violation. Mirrors
      // the same guard in /api/tasks.
      const clear = await supabase
        .from("tasks")
        .update({ is_next_action: false })
        .eq("deal_id", tc.dealId)
        .eq("is_next_action", true);
      if (clear.error) throw new Error(clear.error.message);
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          title,
          deal_id: tc.dealId,
          context: asText(input.context),
          is_next_action: true,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      // A freshly flagged task has no action photo, so re-derive the deal's
      // pointer (clearing whatever the previous holder left behind).
      await syncDealNextActionPhoto(tc.dealId);
      return { ok: true, task_id: data?.id };
    }

    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}

/** The rules that turn a context brief into gap-driven sequencing. */
export function buildSystemPrompt(ctx: SiteVisitContext, checklist: ChecklistState[]): string {
  const gaps = gapsOf(checklist);
  const today = new Date().toISOString().slice(0, 10);

  return `You are riding along on a landscaping site visit. The user is on site, talking to you out loud on an iPad, sometimes with the client standing next to them. Everything below was loaded out of the database before this conversation started.

${renderBrief(ctx, checklist)}

Today's date is ${today}.

How to run this visit:
- Your replies are read aloud. Keep them short and conversational — no markdown, no bullet points, no lists, no headings.
- Ask about ONE gap at a time, then wait. Never fire off a batch of questions.
- Do NOT ask about anything in the "Already known" section. If the user volunteers something that contradicts what is on file, say what you have and ask which is right before overwriting it.
- Work the gaps roughly in the order listed, but follow the conversation where it goes. If the user is standing in front of a drainage problem, take that first.
- Every time you get an answer to a checklist item, call record_answer, then follow the next_step it hands back so the real record gets updated too.
- If a question gets asked but not answered, call log_question so the log stays honest about what was actually asked.
- Use add_note freely for anything worth remembering that no checklist item covers — how the client seemed, a concern, something you noticed.
- Never invent a value, date, or measurement. If you did not hear it, it is still a gap.
- When every gap is closed, say so plainly and stop asking.
${gaps.length === 0 ? "\nEvery checklist item is already answered. Open by saying so, then just take whatever the user wants to tell you and record it with add_note." : ""}`;
}

export async function runSiteVisitTurn(
  history: MessageParam[],
  tc: ToolContext,
  checklist: ChecklistState[]
): Promise<SiteVisitTurnResult> {
  const messages: MessageParam[] = [...history];
  const toolCalls: SiteVisitToolCall[] = [];
  const system = buildSystemPrompt(tc.ctx, checklist);

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const reply = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join(" ")
        .trim();
      return { reply, toolCalls, messages };
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, unknown>;
      try {
        const result = await runTool(block.name, input, tc);
        toolCalls.push({ name: block.name, input, result });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result ?? null),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolCalls.push({ name: block.name, input, error: message });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: ${message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply: "I recorded several things but ran out of steps — check the checklist for what landed.",
    toolCalls,
    messages,
  };
}

/**
 * Close-out summary. A plain completion (no tools) over the conversation, so a
 * later visit's brief can lead with what this one established.
 */
export async function summarizeVisit(turns: { role: string; content: string }[]): Promise<string> {
  const transcript = turns
    .map((t) => `${t.role === "assistant" ? "Assistant" : "User"}: ${t.content}`)
    .join("\n");
  if (!transcript.trim()) return "";

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      "Summarize a landscaping site visit for the person's own future reference. Three or four sentences of plain prose: what the job is, what was learned on site, and what has to happen next. No markdown, no headings, no bullet points. If something was left unresolved, say so.",
    messages: [{ role: "user", content: transcript }],
  });

  return response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join(" ")
    .trim();
}

// Re-exported so route handlers can resolve a checklist without also importing
// the pure module directly.
export { CHECKLIST };
