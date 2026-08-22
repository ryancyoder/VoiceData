// Cell rendering shared by the grid and the row drawer.

export type CellDisplay = { text: string; muted?: boolean; mono?: boolean };

export function formatCell(value: unknown): CellDisplay {
  if (value === null || value === undefined) return { text: "null", muted: true, mono: true };
  if (typeof value === "boolean") return { text: value ? "true" : "false", mono: true };
  if (typeof value === "number") return { text: String(value), mono: true };
  if (typeof value === "string") {
    if (value === "") return { text: "empty", muted: true, mono: true };
    return { text: value };
  }
  return { text: JSON.stringify(value), mono: true };
}

/** Pretty form for the drawer: objects expanded, everything else as-is. */
export function formatFull(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/** `timestamp with time zone` → `timestamptz`, so headers stay narrow. */
export function shortType(type: string): string {
  return type
    .replace("timestamp with time zone", "timestamptz")
    .replace("timestamp without time zone", "timestamp")
    .replace("character varying", "varchar")
    .replace("double precision", "float8");
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}
