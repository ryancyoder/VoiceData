import { loadTables, type TableMeta } from "@/lib/dbBrowser";
import DatabaseClient from "./DatabaseClient";

// Read-only browser for every table Supabase exposes. The schema is loaded on
// the server so the sidebar is there on first paint; if introspection fails we
// render the error in place rather than throwing, since the message (a missing
// env var, usually) is the useful part.

export const dynamic = "force-dynamic";

export default async function DatabasePage() {
  let tables: TableMeta[] = [];
  let loadError: string | null = null;

  try {
    tables = await loadTables();
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load schema";
  }

  return <DatabaseClient initialTables={tables} loadError={loadError} />;
}
