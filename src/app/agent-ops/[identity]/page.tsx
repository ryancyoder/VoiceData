import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { formatWhen, type AgentOpsStatus, type AgentPrompt, type AgentPromptVersion } from "@/lib/agentOps";
import AgentBriefEditor from "./AgentBriefEditor";
import BriefVersions from "./BriefVersions";
import styles from "../agent-ops.module.css";

// One agent's brief: read it, edit it, save it. Saving snapshots the previous
// state into agent_prompt_versions (database trigger), so a bad edit can be
// diffed and rolled back from this same screen.
export const dynamic = "force-dynamic";

const PROMPT_COLS =
  "id, identity, mandate, owned_resources, readonly_resources, run_loop, escalation_rules, handoff_rules, version, updated_by, change_note, created_at, updated_at";

export default async function AgentDetailPage({ params }: { params: Promise<{ identity: string }> }) {
  const { identity: raw } = await params;
  const identity = decodeURIComponent(raw);

  const [promptRes, statusRes, versionsRes] = await Promise.all([
    supabase.from("agent_prompts").select(PROMPT_COLS).eq("identity", identity).maybeSingle(),
    supabase.from("agent_ops_status").select("*").eq("agent_name", identity).maybeSingle(),
    supabase.from("agent_prompt_versions").select("*").eq("identity", identity).order("version", { ascending: false }),
  ]);
  if (promptRes.error) throw new Error(`Failed to load brief: ${promptRes.error.message}`);
  if (statusRes.error) throw new Error(`Failed to load agent: ${statusRes.error.message}`);
  if (versionsRes.error) throw new Error(`Failed to load brief history: ${versionsRes.error.message}`);

  const prompt = promptRes.data as AgentPrompt | null;
  const status = statusRes.data as AgentOpsStatus | null;
  // Neither a registry row nor a brief: nothing to show under this name.
  if (!prompt && !status) notFound();

  const versions = (versionsRes.data ?? []) as AgentPromptVersion[];

  return (
    <div className={styles.page}>
      <Link href="/agent-ops" className={styles.back}>
        ← Agent Ops
      </Link>

      <div className={styles.detailHead}>
        <div>
          <h1>{identity}</h1>
          <p>{status?.role ?? "Not in agent_registry — this brief has no agent behind it."}</p>
        </div>
        <div className={styles.badges}>
          {prompt && <span className={styles.badge}>Brief v{prompt.version}</span>}
          {prompt && (
            <span className={styles.badge}>
              edited {formatWhen(prompt.updated_at)}
              {prompt.updated_by ? ` by ${prompt.updated_by}` : ""}
            </span>
          )}
          {status && (
            <span className={styles.badge}>
              {status.status} · heartbeat {formatWhen(status.last_heartbeat_at)}
            </span>
          )}
          {status && (
            <span className={styles.badge}>
              {status.queued} queued · {status.in_flight} in flight · {status.failed} failed
            </span>
          )}
        </div>
      </div>

      {prompt ? (
        <>
          <AgentBriefEditor prompt={prompt} />
          <BriefVersions identity={identity} currentVersion={prompt.version} versions={versions} />
        </>
      ) : (
        <>
          <div className={styles.card}>
            <div className={styles.sectionHead}>
              <h2>No brief yet</h2>
            </div>
            <p className={styles.fieldHint}>
              <strong>{identity}</strong> is registered but has no brief, so a session loading it becomes an agent
              with no lane, no run loop and no escalation rules. Fill this in and create the row — the owned and
              read-only lists matter most, because those are what prevent damage.
            </p>
          </div>
          <AgentBriefEditor identity={identity} />
        </>
      )}
    </div>
  );
}
