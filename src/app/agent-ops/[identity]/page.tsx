import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import type { AgentDocument, AgentDocumentListing, AgentPrompt, AgentPromptVersion } from "@/lib/agentOps";
import AgentBriefEditor from "../AgentBriefEditor";
import AgentDocuments from "../AgentDocuments";
import AppIcon from "../apps/AppIcon";
import styles from "../agentOps.module.css";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: Promise<{ identity: string }> }) {
  const { identity: raw } = await params;
  const identity = decodeURIComponent(raw);

  const [promptRes, registryRes, versionsRes, docsRes, linksRes, appsRes] = await Promise.all([
    supabase.from("agent_prompts").select("*").eq("identity", identity).maybeSingle(),
    supabase.from("agent_registry").select("agent_name, role, status, last_heartbeat_at").eq("agent_name", identity).maybeSingle(),
    supabase
      .from("agent_prompt_versions")
      .select("*")
      .eq("identity", identity)
      .order("version", { ascending: false }),
    supabase.from("agent_documents").select("*").order("title"),
    supabase.from("agent_document_links").select("document_id").eq("identity", identity),
    identity === "app-developer"
      ? supabase.from("apps").select("id, slug, name, status, summary, icon_url").order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (promptRes.error) throw new Error(promptRes.error.message);
  if (registryRes.error) throw new Error(registryRes.error.message);
  if (versionsRes.error) throw new Error(versionsRes.error.message);
  if (docsRes.error) throw new Error(docsRes.error.message);
  if (linksRes.error) throw new Error(linksRes.error.message);
  if (appsRes.error) throw new Error(appsRes.error.message);

  const apps = (appsRes.data ?? []) as {
    id: number;
    slug: string;
    name: string;
    status: string;
    icon_url: string | null;
  }[];
  const activeApps = apps.filter((a) => a.status !== "archived");

  const linkedIds = new Set(
    ((linksRes.data ?? []) as { document_id: number }[]).map((l) => l.document_id)
  );
  // A global document is on every agent's shelf without a link row; `linked`
  // stays false for it so Detach never offers to remove something it cannot.
  const documents: AgentDocumentListing[] = ((docsRes.data ?? []) as AgentDocument[]).map((d) => ({
    ...d,
    linked: linkedIds.has(d.id),
  }));

  const registry = registryRes.data as { agent_name: string; role: string } | null;
  if (!registry) notFound();

  const prompt = promptRes.data as AgentPrompt | null;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/agent-ops" className={styles.back}>
          ← Agent Ops
        </Link>
        <h1>{registry.agent_name}</h1>
        <p>{registry.role}</p>
        <p>
          This is what the agent reads at the start of every session. Change a field, say why, and save —
          the version it replaces is kept below, so a bad edit can be read back and undone.
        </p>
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          {prompt ? (
            <AgentBriefEditor
              identity={identity}
              initialPrompt={prompt}
              initialVersions={(versionsRes.data ?? []) as AgentPromptVersion[]}
            />
          ) : (
            <div className={styles.card}>
              <p className={styles.empty}>
                This agent is registered but has no brief row yet. Seed <code>agent_prompts</code> for{" "}
                <code>{identity}</code> and it will show up here.
              </p>
            </div>
          )}
        </div>
        <div className={styles.column}>
          {apps.length > 0 && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Apps</h2>
                  <p>
                    The builds this agent is responsible for. Each one keeps its own documentation.
                  </p>
                </div>
                <Link href="/agent-ops/apps" className={styles.ghostButton}>
                  All {apps.length}
                </Link>
              </div>
              <ul className={styles.docList}>
                {activeApps.map((app) => (
                  <li key={app.id}>
                    <Link href={`/agent-ops/apps/${app.slug}`} className={styles.appRow}>
                      <AppIcon app={app} size={28} />
                      <span className={styles.appRowText}>
                        <span className={styles.docTitle}>{app.name}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AgentDocuments scope={{ kind: "agent", identity }} initialDocuments={documents} />
        </div>
      </div>
    </div>
  );
}
