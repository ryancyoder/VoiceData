// Parse an Aspire catalog CSV export (client-side) into rows for the import API.
// Handles RFC-4180 quoting: quoted fields, embedded commas/newlines, and ""
// escaped quotes. Strips a leading UTF-8 BOM.

export interface AspireImportRow {
  item_name: string;
  category_name: string | null;
  item_type: string | null;
  purchase_unit_type: string | null;
  item_cost: number | null;
  item_code: string | null;
  active: boolean;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      // Skip fully-blank lines.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function toNum(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function nz(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

export function parseAspireCsv(text: string): AspireImportRow[] {
  const grid = parseCsv(text);
  if (grid.length < 2) return [];
  const header = grid[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iName = idx("Item Name");
  const iCat = idx("Category Name");
  const iType = idx("Item Type");
  const iUnit = idx("Purchase Unit Type");
  const iCost = idx("Item Cost");
  const iCode = idx("Item Code");
  const iActive = idx("Active");
  if (iName < 0) throw new Error('CSV is missing an "Item Name" column.');

  const out: AspireImportRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const name = (cells[iName] ?? "").trim();
    if (!name) continue;
    out.push({
      item_name: name,
      category_name: iCat >= 0 ? nz(cells[iCat] ?? "") : null,
      item_type: iType >= 0 ? nz(cells[iType] ?? "") : null,
      purchase_unit_type: iUnit >= 0 ? nz(cells[iUnit] ?? "") : null,
      item_cost: iCost >= 0 ? toNum(cells[iCost] ?? "") : null,
      item_code: iCode >= 0 ? nz(cells[iCode] ?? "") : null,
      active: iActive >= 0 ? (cells[iActive] ?? "").trim().toUpperCase() !== "FALSE" : true,
    });
  }
  return out;
}
