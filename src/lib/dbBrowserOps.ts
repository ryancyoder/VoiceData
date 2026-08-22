// The filter operators the table browser offers. Shared by the client UI and
// the /api/database/rows route so the dropdown can never ask for an operator
// the server won't run — the route rejects anything not in this list rather
// than passing a caller-supplied operator through to PostgREST.

export const FILTER_OPERATORS = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "ilike", label: "contains" },
  { value: "isnull", label: "is null" },
  { value: "notnull", label: "is not null" },
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number]["value"];

/** Operators that ignore the value box (and disable it in the UI). */
export const VALUELESS_OPERATORS: readonly FilterOperator[] = ["isnull", "notnull"];

export function isFilterOperator(value: string): value is FilterOperator {
  return FILTER_OPERATORS.some((op) => op.value === value);
}
