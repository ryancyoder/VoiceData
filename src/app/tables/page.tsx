import { listTables, type TableInfo } from "@/lib/tableBrowser";
import TableBrowserClient from "./TableBrowserClient";
import styles from "./tables.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tables · VoiceData",
  description: "Browse the Supabase database.",
};

export default async function TablesPage({ searchParams }: PageProps<"/tables">) {
  const { table } = await searchParams;
  const initialTable = typeof table === "string" ? table : null;

  let tables: TableInfo[] = [];
  let error: string | null = null;
  try {
    tables = await listTables();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load the schema";
  }

  if (error) {
    return (
      <div className={styles.page} data-fullheight>
        <div className={styles.fatal}>
          <h1>Tables</h1>
          <p>{error}</p>
          <p className={styles.fatalHint}>
            This screen reads the schema straight from Supabase, so it needs{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> and a Supabase API key
            (<code>SUPABASE_SERVICE_ROLE_KEY</code>, or the anon key as a fallback) in the
            environment.
          </p>
        </div>
      </div>
    );
  }

  return <TableBrowserClient tables={tables} initialTable={initialTable} />;
}
