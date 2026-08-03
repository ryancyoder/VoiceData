import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import * as db from "./db";

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ITERATIONS = 8;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const columnSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string", description: "Column name (letters, numbers, underscores)" },
    type: {
      type: "string",
      enum: ["text", "integer", "real", "boolean", "date"],
      description: "Column data type",
    },
  },
  required: ["name", "type"],
};

const tools: Tool[] = [
  {
    name: "list_tables",
    description: "List the names of all tables currently in the database.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "describe_database",
    description:
      "Get the full schema of the database: every table and its columns with types. Call this whenever you need to know what already exists before creating or modifying something.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_table",
    description:
      "Create a new table. An id, created_at, and updated_at column are added automatically — do not include them.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Table name (letters, numbers, underscores)" },
        columns: { type: "array", items: columnSchema, minItems: 1 },
      },
      required: ["name", "columns"],
    },
  },
  {
    name: "add_column",
    description: "Add a new column to an existing table.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string" },
        column: columnSchema,
      },
      required: ["table", "column"],
    },
  },
  {
    name: "delete_table",
    description: "Permanently delete a table and all of its rows. Only do this if the user clearly confirms.",
    input_schema: {
      type: "object",
      properties: { table: { type: "string" } },
      required: ["table"],
    },
  },
  {
    name: "insert_row",
    description: "Insert a new row into a table. Keys in data must match existing column names.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string" },
        data: { type: "object", additionalProperties: true },
      },
      required: ["table", "data"],
    },
  },
  {
    name: "update_row",
    description: "Update fields on an existing row, identified by its id.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string" },
        id: { type: "integer" },
        data: { type: "object", additionalProperties: true },
      },
      required: ["table", "id", "data"],
    },
  },
  {
    name: "delete_row",
    description: "Delete a row from a table by id.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string" },
        id: { type: "integer" },
      },
      required: ["table", "id"],
    },
  },
  {
    name: "query_rows",
    description: "Read rows from a table, optionally filtered by exact-match column values.",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string" },
        filters: { type: "object", additionalProperties: true },
        limit: { type: "integer" },
      },
      required: ["table"],
    },
  },
];

function runTool(name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case "list_tables":
      return db.listTables();
    case "describe_database":
      return db.describeDatabase();
    case "create_table":
      return db.createTable(
        input.name as string,
        input.columns as db.ColumnDef[]
      );
    case "add_column":
      return db.addColumn(input.table as string, input.column as db.ColumnDef);
    case "delete_table":
      db.deleteTable(input.table as string);
      return { ok: true };
    case "insert_row":
      return db.insertRow(
        input.table as string,
        input.data as Record<string, unknown>
      );
    case "update_row":
      return db.updateRow(
        input.table as string,
        input.id as number,
        input.data as Record<string, unknown>
      );
    case "delete_row":
      db.deleteRow(input.table as string, input.id as number);
      return { ok: true };
    case "query_rows":
      return db.queryRows(
        input.table as string,
        input.filters as Record<string, unknown> | undefined,
        input.limit as number | undefined
      );
    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}

const SYSTEM_PROMPT = `You are a voice-driven database assistant. The user speaks to you and you help them design and populate a database on the fly, using the provided tools to create tables, add columns, and insert/update/delete/query rows.

Rules:
- Your replies are read aloud by text-to-speech, so keep them short, conversational, and free of markdown, bullet points, or code blocks.
- Infer reasonable table and column names and types from what the user says. Don't ask for confirmation on routine, unambiguous actions — just do it and briefly say what you did.
- Do ask a short clarifying question if the request is genuinely ambiguous (e.g. unclear which table, or a destructive action like deleting a table).
- Call describe_database or list_tables when you're unsure what already exists rather than guessing.
- When inserting data, reuse existing tables and columns instead of creating duplicates with slightly different names.
- Keep spoken confirmations brief, e.g. "Added a contacts table with name, phone, and email." rather than restating everything verbatim.`;

export interface ChatTurnResult {
  reply: string;
  schema: db.TableSchema[];
  toolCalls: { name: string; input: unknown; result?: unknown; error?: string }[];
  messages: MessageParam[];
}

export async function runChatTurn(
  history: MessageParam[]
): Promise<ChatTurnResult> {
  const messages: MessageParam[] = [...history];
  const toolCalls: ChatTurnResult["toolCalls"] = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
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
      return { reply, schema: db.describeDatabase(), toolCalls, messages };
    }

    const toolResults: ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const input = block.input as Record<string, unknown>;
      try {
        const result = runTool(block.name, input);
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
    reply:
      "I made several changes but ran out of steps to summarize them all — check the database panel for the latest state.",
    schema: db.describeDatabase(),
    toolCalls,
    messages,
  };
}
