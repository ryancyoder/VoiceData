import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { TASK_CONTEXTS, type TaskContext } from "@/lib/tasks";

const MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export interface AnalyzedTaskFields {
  context: TaskContext | null;
  start_date: string | null;
  duration_hours: number | null;
}

const EXTRACT_TOOL: Tool = {
  name: "extract_task_fields",
  description: "Extract structured scheduling fields from a task dictated by voice at a landscaping business.",
  input_schema: {
    type: "object",
    properties: {
      context: {
        type: "string",
        enum: [...TASK_CONTEXTS],
        description:
          "Best-guess GTD-style context for where/how this task gets done: Office (paperwork, computer work, general calls/admin), Field (on-site/jobsite work), Phone (a specific phone call), Design (drafting/planning), Errand (shopping, supply pickup), Waiting (blocked on someone else). Omit this field entirely if genuinely unclear from the text.",
      },
      start_date: {
        type: "string",
        description:
          "ISO date (YYYY-MM-DD) if a specific date, weekday, or relative date ('tomorrow', 'next Tuesday', 'Friday', 'in two weeks') is mentioned, resolved against the given current date. Omit entirely if no date is mentioned.",
      },
      duration_hours: {
        type: "number",
        description:
          "Estimated duration in hours if mentioned or clearly implied ('half a day' → 4, 'a quick call' → 0.25, 'a couple hours' → 2). Omit entirely if not mentioned or reasonably inferable.",
      },
    },
  },
};

function isTaskContext(value: unknown): value is TaskContext {
  return typeof value === "string" && (TASK_CONTEXTS as readonly string[]).includes(value);
}

// Runs after a task is already logged from raw dictated text (see
// /api/tasks/[id]/analyze) — this only ever fills in metadata (context,
// dates, duration), never rewrites the title the user actually said.
export async function analyzeTaskText(text: string): Promise<AnalyzedTaskFields> {
  const today = new Date().toISOString().slice(0, 10);
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 512,
    system: `Today's date is ${today}. Extract structured scheduling fields from a landscaping-business task dictated by voice. Call extract_task_fields exactly once with whatever fields are actually supported by the text — omit any field the text doesn't clearly imply.`,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "extract_task_fields" },
    messages: [{ role: "user", content: text }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    return { context: null, start_date: null, duration_hours: null };
  }
  const input = block.input as Record<string, unknown>;

  return {
    context: isTaskContext(input.context) ? input.context : null,
    start_date: typeof input.start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.start_date) ? input.start_date : null,
    duration_hours: typeof input.duration_hours === "number" && Number.isFinite(input.duration_hours) ? input.duration_hours : null,
  };
}
