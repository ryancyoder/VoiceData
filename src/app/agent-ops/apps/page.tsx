import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import type { App } from "@/lib/agentOps";
import AppList from "./AppList";
import styles from "../agentOps.module.css";

export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const [appsRes, linksRes] = await Promise.all([
    supabase.from("apps").select("*").order("name"),
    supabase.from("app_documents").select("app_id"),
  ]);
  if (appsRes.error) throw new Error(appsRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);

  const docCounts: Record<number, number> = {};
  for (const link of (linksRes.data ?? []) as { app_id: number }[]) {
    docCounts[link.app_id] = (docCounts[link.app_id] ?? 0) + 1;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/agent-ops/app-developer" className={styles.back}>
          ← app-developer
        </Link>
        <h1>Apps</h1>
        <p>The builds and coding projects app-developer is responsible for.</p>
      </div>
      <AppList initialApps={(appsRes.data ?? []) as App[]} docCounts={docCounts} />
    </div>
  );
}
