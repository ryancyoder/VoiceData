import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { repoUrl, type AgentDocument, type AgentDocumentListing, type App } from "@/lib/agentOps";
import AgentDocuments from "../../AgentDocuments";
import AppDetails from "./AppDetails";
import styles from "../../agentOps.module.css";

export const dynamic = "force-dynamic";

export default async function AppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);

  const appRes = await supabase.from("apps").select("*").eq("slug", slug).maybeSingle();
  if (appRes.error) throw new Error(appRes.error.message);
  const app = appRes.data as App | null;
  if (!app) notFound();

  const [docsRes, linksRes] = await Promise.all([
    supabase.from("agent_documents").select("*").order("title"),
    supabase.from("app_documents").select("document_id").eq("app_id", app.id),
  ]);
  if (docsRes.error) throw new Error(docsRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);

  const linked = new Set(((linksRes.data ?? []) as { document_id: number }[]).map((l) => l.document_id));
  const documents: AgentDocumentListing[] = ((docsRes.data ?? []) as AgentDocument[]).map((d) => ({
    ...d,
    linked: linked.has(d.id),
  }));

  const github = repoUrl(app.repo);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/agent-ops/apps" className={styles.back}>
          ← Apps
        </Link>
        <h1>{app.name}</h1>
        <p>{app.summary || "No summary yet."}</p>
        <div className={styles.inboxMeta}>
          {github && (
            <a href={github} target="_blank" rel="noreferrer">
              {app.repo}
            </a>
          )}
          {app.live_url && (
            <a href={app.live_url} target="_blank" rel="noreferrer">
              live
            </a>
          )}
          <span>{app.status}</span>
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          <AgentDocuments
            scope={{ kind: "app", appId: app.id, appName: app.name }}
            initialDocuments={documents}
          />
        </div>
        <div className={styles.column}>
          <AppDetails app={app} />
        </div>
      </div>
    </div>
  );
}
