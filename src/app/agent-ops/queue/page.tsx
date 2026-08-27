import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import type { QueueRow } from "@/lib/agentOps";
import QueueClient from "./QueueClient";
import styles from "../agentOps.module.css";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const [liveRes, doneRes, agentsRes] = await Promise.all([
    supabase.from("agent_queue_live").select("*"),
    supabase
      .from("agent_queue")
      .select("*")
      .in("status", ["done", "cancelled"])
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(40),
    supabase.from("agent_registry").select("agent_name").order("agent_name"),
  ]);
  if (liveRes.error) throw new Error(liveRes.error.message);
  if (doneRes.error) throw new Error(doneRes.error.message);
  if (agentsRes.error) throw new Error(agentsRes.error.message);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Link href="/agent-ops" className={styles.back}>
          ← Agent Ops
        </Link>
        <h1>Queue</h1>
        <p>
          The bus every agent works from. A row is one durable request from one agent to another —
          claimed, worked, and closed, or handed back when it fails.
        </p>
      </div>

      <QueueClient
        initialLive={(liveRes.data ?? []) as QueueRow[]}
        initialFinished={(doneRes.data ?? []) as QueueRow[]}
        agents={((agentsRes.data ?? []) as { agent_name: string }[]).map((a) => a.agent_name)}
      />
    </div>
  );
}
