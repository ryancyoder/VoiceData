"use client";

import { useState } from "react";
import Link from "next/link";
import { queueRowState, shortAge, type QueueRow } from "@/lib/agentOps";
import styles from "../agentOps.module.css";

type Filter = "attention" | "pending" | "in-flight" | "finished" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "pending", label: "Pending" },
  { key: "in-flight", label: "In flight" },
  { key: "finished", label: "Finished" },
  { key: "all", label: "All" },
];

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    const text = JSON.stringify(value, null, 2);
    return text === "{}" ? "" : text;
  } catch {
    return String(value);
  }
}

// The bus, as something a person can read and act on. Everything an agent does
// passes through here, so this is where a stuck lane, a row nobody claimed, or
// an agent failing the same request three times becomes visible.
export default function QueueClient({
  initialLive,
  initialFinished,
  agents,
}: {
  initialLive: QueueRow[];
  initialFinished: QueueRow[];
  agents: string[];
}) {
  const [live, setLive] = useState(initialLive);
  const [finished, setFinished] = useState(initialFinished);
  const [filter, setFilter] = useState<Filter>("attention");
  const [agent, setAgent] = useState("");
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | "reap" | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // Read the clock once, when the component first mounts, rather than during
  // every render — a render that reads the current time is not pure, and the
  // lease countdowns do not need to tick.
  const [now] = useState(() => Date.now());
  const expired = (row: QueueRow) =>
    row.status === "claimed" && !!row.lease_expires_at && new Date(row.lease_expires_at).getTime() < now;

  const counts = {
    attention: live.filter((r) => r.status === "failed" || expired(r)).length,
    pending: live.filter((r) => r.status === "pending").length,
    "in-flight": live.filter((r) => r.status === "claimed" && !expired(r)).length,
    finished: finished.length,
    all: live.length + finished.length,
  };

  const rows = (() => {
    const pool = filter === "finished" ? finished : filter === "all" ? [...live, ...finished] : live;
    const byFilter = pool.filter((row) => {
      switch (filter) {
        case "attention":
          return row.status === "failed" || expired(row);
        case "pending":
          return row.status === "pending";
        case "in-flight":
          return row.status === "claimed" && !expired(row);
        default:
          return true;
      }
    });
    return agent ? byFilter.filter((r) => r.to_agent === agent) : byFilter;
  })();

  async function act(row: QueueRow, action: "retry" | "release" | "cancel") {
    setBusy(row.id);
    setError("");
    setNote("");
    try {
      const res = await fetch(`/api/agent-ops/queue/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not do that");
      const updated = { ...row, ...(data.row as QueueRow) };

      if (updated.status === "cancelled") {
        setLive((prev) => prev.filter((r) => r.id !== row.id));
        setFinished((prev) => [updated, ...prev]);
      } else {
        setLive((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      }
      setNote(`#${row.id} ${action === "cancel" ? "cancelled" : action === "retry" ? "queued again" : "released"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not do that");
    } finally {
      setBusy(null);
    }
  }

  async function reap() {
    setBusy("reap");
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/agent-ops/queue/reap", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reap");
      const count = data.reaped as number;
      setNote(
        count === 0
          ? "No expired leases to hand back."
          : `${count} row${count === 1 ? "" : "s"} handed back. Reload to see them.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reap");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>Filters</h2>
            <p>
              Everything one agent asks another for passes through this queue. A row sitting unclaimed,
              or failing the same way three times, is the first sign a lane is wrong.
            </p>
          </div>
          <button type="button" className={styles.ghostButton} disabled={busy === "reap"} onClick={reap}>
            {busy === "reap" ? "Reaping…" : "Reap expired leases"}
          </button>
        </div>

        <div className={styles.chips}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? styles.chipOn : styles.chip}
              onClick={() => setFilter(f.key)}
            >
              {f.label} <span className={styles.chipCount}>{counts[f.key]}</span>
            </button>
          ))}
        </div>

        <div className={styles.chips}>
          <button
            type="button"
            className={agent === "" ? styles.chipOn : styles.chip}
            onClick={() => setAgent("")}
          >
            every agent
          </button>
          {agents.map((name) => (
            <button
              key={name}
              type="button"
              className={agent === name ? styles.chipOn : styles.chip}
              onClick={() => setAgent(name)}
            >
              {name}
            </button>
          ))}
        </div>

        {error && <p className={styles.error}>{error}</p>}
        {note && <p className={styles.note}>{note}</p>}
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h2>
              {rows.length} row{rows.length === 1 ? "" : "s"}
            </h2>
            <p>Tap one to see its payload, its result, and what to do about it.</p>
          </div>
        </div>

        {rows.length === 0 && (
          <p className={styles.empty}>
            Nothing here. The queue fills when one agent asks another for something —
            <code> enqueue_agent_work(...)</code> — and empties as they work it. It stays empty while no
            agent is running.
          </p>
        )}

        <ul className={styles.queue}>
          {rows.map((row) => {
            const state = queueRowState(row, now);
            const open = openRow === row.id;
            const payload = pretty(row.payload);
            const result = pretty(row.result);
            return (
              <li key={`${row.id}-${row.status}`} className={styles[`q_${state.tone}`]}>
                <button
                  type="button"
                  className={styles.queueHead}
                  onClick={() => setOpenRow(open ? null : row.id)}
                >
                  <span className={styles.queueIntent}>
                    <span className={styles.queueId}>#{row.id}</span> {row.intent}
                  </span>
                  <span className={styles.queueRoute}>
                    {row.from_agent} <span aria-hidden>→</span> {row.to_agent}
                  </span>
                  <span className={styles.queueState}>
                    {state.label}
                    {row.attempts > 0 && ` · try ${row.attempts}/${row.max_attempts}`}
                    {` · ${shortAge(row.created_at)} old`}
                  </span>
                </button>

                {open && (
                  <div className={styles.queueBody}>
                    {row.error && <p className={styles.queueError}>{row.error}</p>}

                    <dl className={styles.queueFacts}>
                      <div>
                        <dt>priority</dt>
                        <dd>{row.priority}</dd>
                      </div>
                      {row.deal_id && (
                        <div>
                          <dt>deal</dt>
                          <dd>
                            <Link href={`/sales-board?deal=${row.deal_id}`}>
                              {row.deal_name ?? `#${row.deal_id}`}
                            </Link>
                          </dd>
                        </div>
                      )}
                      {row.claimed_by && (
                        <div>
                          <dt>claimed by</dt>
                          <dd>
                            {row.claimed_by} · {shortAge(row.claimed_at)} ago
                          </dd>
                        </div>
                      )}
                      {row.completed_at && (
                        <div>
                          <dt>finished</dt>
                          <dd>{shortAge(row.completed_at)} ago</dd>
                        </div>
                      )}
                    </dl>

                    {payload && (
                      <div>
                        <span className={styles.fieldLabel}>payload</span>
                        <pre className={styles.queueJson}>{payload}</pre>
                      </div>
                    )}
                    {result && (
                      <div>
                        <span className={styles.fieldLabel}>result</span>
                        <pre className={styles.queueJson}>{result}</pre>
                      </div>
                    )}

                    <div className={styles.actions}>
                      {(row.status === "failed" || row.status === "cancelled") && (
                        <button
                          type="button"
                          className={styles.ghostButton}
                          disabled={busy === row.id}
                          onClick={() => act(row, "retry")}
                        >
                          Queue it again
                        </button>
                      )}
                      {row.status === "claimed" && (
                        <button
                          type="button"
                          className={styles.ghostButton}
                          disabled={busy === row.id}
                          onClick={() => act(row, "release")}
                        >
                          Release
                        </button>
                      )}
                      {(row.status === "pending" || row.status === "failed" || row.status === "claimed") && (
                        <button
                          type="button"
                          className={styles.ghostButton}
                          disabled={busy === row.id}
                          onClick={() => act(row, "cancel")}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
