"use client";

import { useState } from "react";
import Link from "next/link";
import type { HumanActionItem, PendingReviewItem } from "@/lib/agentOps";
import styles from "./agentOps.module.css";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function day(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// What the agents could not do without Ryan. This is the one screen in Agent
// Ops that is his rather than theirs — the tiles below are for tending the
// system, this is the work it handed back.
export default function HumanActionInbox({
  initialItems,
  initialHeld,
}: {
  initialItems: HumanActionItem[];
  initialHeld: PendingReviewItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [held, setHeld] = useState(initialHeld);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [showHeld, setShowHeld] = useState(false);

  async function done(id: number) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error || "Could not complete it");
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete it");
    } finally {
      setBusy(null);
    }
  }

  // Release a held item without waiting for project-manager. The wording will
  // be the agent's own rather than a rewritten version.
  async function release(id: number) {
    setBusy(id);
    setError("");
    try {
      const res = await fetch(`/api/agent-ops/inbox/${id}/review`, { method: "POST" });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error || "Could not release it");
      const item = held.find((h) => h.id === id);
      setHeld((prev) => prev.filter((h) => h.id !== id));
      if (item) {
        setItems((prev) => [
          ...prev,
          {
            id: item.id,
            title: item.title,
            human_instructions: item.human_instructions,
            deal_id: null,
            deal_name: null,
            deal_value: null,
            start_date: null,
            created_by_agent: item.created_by_agent,
            created_at: item.created_at,
          },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release it");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>Needs you{items.length > 0 ? ` (${items.length})` : ""}</h2>
          <p>
            What the agents could not finish on their own. Everything here has been through
            project-manager, so it should read like something you can act on.
          </p>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {items.length === 0 && (
        <p className={styles.empty}>
          Nothing waiting. This fills up once agents start running and hit something only you can
          decide — an unclear scope, a number going to a client, a match they are not sure about.
        </p>
      )}

      <ul className={styles.inbox}>
        {items.map((item) => (
          <li key={item.id} className={styles.inboxItem}>
            <div className={styles.inboxHead}>
              <span className={styles.inboxTitle}>{item.title}</span>
              <button type="button" onClick={() => done(item.id)} disabled={busy === item.id}>
                {busy === item.id ? "…" : "Done"}
              </button>
            </div>
            {item.human_instructions && <p className={styles.inboxBody}>{item.human_instructions}</p>}
            <div className={styles.inboxMeta}>
              {item.created_by_agent && <span>from {item.created_by_agent}</span>}
              {item.deal_id && (
                <Link href={`/sales-board?deal=${item.deal_id}`}>
                  {item.deal_name ?? `Deal ${item.deal_id}`}
                  {item.deal_value ? ` · ${money.format(item.deal_value)}` : ""}
                </Link>
              )}
              {item.start_date && <span>due {day(item.start_date)}</span>}
              <span>raised {day(item.created_at)}</span>
            </div>
          </li>
        ))}
      </ul>

      {held.length > 0 && (
        <div className={styles.heldBlock}>
          <button type="button" className={styles.ghostButton} onClick={() => setShowHeld(!showHeld)}>
            {showHeld ? "Hide" : `${held.length} held for review`}
          </button>
          <p className={styles.fieldHint}>
            An agent raised these, but project-manager has not rewritten the wording yet — so they are
            deliberately not in the list above. Nothing runs project-manager on a schedule, so release one
            yourself if it should not wait.
          </p>
          {showHeld && (
            <ul className={styles.inbox}>
              {held.map((item) => (
                <li key={item.id} className={styles.inboxItem}>
                  <div className={styles.inboxHead}>
                    <span className={styles.inboxTitle}>{item.title}</span>
                    <button type="button" onClick={() => release(item.id)} disabled={busy === item.id}>
                      {busy === item.id ? "…" : "Release"}
                    </button>
                  </div>
                  {item.human_instructions && <p className={styles.inboxBody}>{item.human_instructions}</p>}
                  <div className={styles.inboxMeta}>
                    {item.created_by_agent && <span>from {item.created_by_agent}</span>}
                    <span>raised {day(item.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
