import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import type { AgentStatus, HumanActionItem, PendingReviewItem } from "@/lib/agentOps";
import HumanActionInbox from "./HumanActionInbox";
import styles from "./agentOps.module.css";

export const dynamic = "force-dynamic";

interface PromptMeta {
  identity: string;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

function ago(ts: string | null): string {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (!Number.isFinite(mins)) return "never";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function AgentOpsPage() {
  const [statusRes, promptRes, inboxRes, heldRes] = await Promise.all([
    supabase.from("agent_ops_status").select("*").order("agent_name"),
    supabase.from("agent_prompts").select("identity, version, updated_at, updated_by"),
    supabase.from("human_action_inbox").select("*"),
    supabase.from("pending_pm_review").select("*"),
  ]);
  if (statusRes.error) throw new Error(`Failed to load agents: ${statusRes.error.message}`);
  if (promptRes.error) throw new Error(`Failed to load briefs: ${promptRes.error.message}`);
  if (inboxRes.error) throw new Error(`Failed to load the inbox: ${inboxRes.error.message}`);
  if (heldRes.error) throw new Error(`Failed to load held items: ${heldRes.error.message}`);

  const agents = (statusRes.data ?? []) as AgentStatus[];
  const briefs = new Map<string, PromptMeta>(
    ((promptRes.data ?? []) as PromptMeta[]).map((p) => [p.identity, p])
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Agent Ops</h1>
        <p>
          Every agent&apos;s brief lives here, not in a file on a laptop. Tap an agent to read or change the
          rules it runs on — the change takes effect on its next session, with no redeploy.
        </p>
      </div>

      <HumanActionInbox
        initialItems={(inboxRes.data ?? []) as HumanActionItem[]}
        initialHeld={(heldRes.data ?? []) as PendingReviewItem[]}
      />

      <details className={styles.howto} open>
        <summary>How this works</summary>
        <ol>
          <li>
            <strong>An agent is a Claude session that loaded one of these briefs.</strong> Open an agent,
            tap <em>Copy brief</em>, and paste it into a new session. That session is now that agent.
          </li>
          <li>
            <strong>It works from the queue.</strong> It claims rows addressed to it, does the work inside
            its own lane, marks them done, and can leave work for another agent. Agents never call each
            other directly — a row in the queue is the only way one reaches another.
          </li>
          <li>
            <strong>When one gets something wrong, you change its brief, not the code.</strong> Edit the
            field here, say why, save. The next session it runs, it follows the new rule.
          </li>
          <li>
            <strong>Anything it can&apos;t do without you</strong> lands in <em>Needs you</em> at the top
            of this page, after project-manager has made the wording readable. It is a task too, so it
            also shows up on the Tasks screen.
          </li>
        </ol>
        <p>
          Nothing runs on a schedule yet — an agent only runs while a session is holding its brief. The
          counts below are that agent&apos;s queue: <em>queued</em> is waiting for it, <em>in flight</em>
          is claimed right now, <em>failed</em> needs a look. The dot is green when it has checked in
          within the last half hour.
        </p>
      </details>

      <div className={styles.tiles}>
        {agents.map((agent) => {
          const brief = briefs.get(agent.agent_name);
          return (
            <Link key={agent.agent_name} href={`/agent-ops/${agent.agent_name}`} className={styles.tile}>
              <div className={styles.tileHead}>
                <span className={styles.tileName}>{agent.agent_name}</span>
                <span className={agent.stale ? styles.dotStale : styles.dotLive} aria-hidden />
              </div>
              <p className={styles.tileRole}>{agent.role}</p>
              <div className={styles.counts}>
                <span>{agent.queued} queued</span>
                <span>{agent.in_flight} in flight</span>
                <span className={agent.failed > 0 ? styles.bad : undefined}>{agent.failed} failed</span>
              </div>
              <div className={styles.tileFoot}>
                {brief ? `Brief v${brief.version} · edited ${ago(brief.updated_at)}` : "No brief yet"}
                <span> · heartbeat {ago(agent.last_heartbeat_at)}</span>
              </div>
            </Link>
          );
        })}
        {agents.length === 0 && <p className={styles.empty}>No agents registered.</p>}
      </div>
    </div>
  );
}
