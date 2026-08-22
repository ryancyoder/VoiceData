// Column filters for the table browser (/tables).
//
// This module is imported by both the API route and the client component, so
// it deliberately pulls in nothing else — importing the schema helpers would
// drag the Supabase client into the browser bundle.

export const FILTER_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "startsWith",
  "endsWith",
  "in",
  "is_null",
  "not_null",
] as const;

export type FilterOp = (typeof FILTER_OPS)[number];

/** Operators that test the column itself and ignore any value typed for them. */
export const VALUELESS_OPS: readonly FilterOp[] = ["is_null", "not_null"];

/** Short symbols for the operator dropdown, which has to stay narrow. */
export const OP_LABELS: Record<FilterOp, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "has",
  startsWith: "a…",
  endsWith: "…z",
  in: "in",
  is_null: "∅",
  not_null: "!∅",
};

export const OP_TITLES: Record<FilterOp, string> = {
  eq: "equals",
  neq: "not equal",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  in: "in list (comma separated)",
  is_null: "is null",
  not_null: "is not null",
};

const TEXT_TYPES = new Set(["text", "character varying", "varchar", "character", "char", "citext", "name"]);

/** Text columns default to a substring match; everything else to equality. */
export function defaultOpFor(type: string): FilterOp {
  return TEXT_TYPES.has(type) ? "contains" : "eq";
}

export type ColumnFilter = { column: string; op: FilterOp; value: string };

/** A malformed filter is the caller's fault — the route answers 400, not 500. */
export class FilterError extends Error {}

/**
 * Parse the `filters` query parameter: a JSON array of {column, op, value}.
 * The operator must come from FILTER_OPS and the column must be one the table
 * actually has, so a filter can only narrow a SELECT the caller could already
 * run — it can never reach a different relation.
 */
export function parseFilters(raw: string | null, knownColumns: Set<string>): ColumnFilter[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FilterError("filters must be a JSON array");
  }
  if (!Array.isArray(parsed)) throw new FilterError("filters must be a JSON array");

  return parsed.map((entry) => {
    const f = (entry ?? {}) as { column?: unknown; op?: unknown; value?: unknown };
    if (typeof f.column !== "string" || !knownColumns.has(f.column)) {
      throw new FilterError(`Unknown column "${String(f.column)}"`);
    }
    if (typeof f.op !== "string" || !(FILTER_OPS as readonly string[]).includes(f.op)) {
      throw new FilterError(`Unsupported operator "${String(f.op)}"`);
    }
    return { column: f.column, op: f.op as FilterOp, value: f.value == null ? "" : String(f.value) };
  });
}
