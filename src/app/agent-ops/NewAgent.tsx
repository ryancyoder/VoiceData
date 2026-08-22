"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { agentNameError } from "@/lib/agentOps";
import styles from "./agentOps.module.css";

// Registering an agent is two rows — a registry entry and a brief — and the
// console writes both, so a new agent always has something to load.
export default function NewAgent() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ agent_name: "", role: "", mandate: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nameProblem = draft.agent_name ? agentNameError(draft.agent_name) : null;

  async function create() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/agent-ops/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create it");
      router.push(`/agent-ops/${encodeURIComponent(draft.agent_name.trim().toLowerCase())}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create it");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.ghostButton} onClick={() => setOpen(true)}>
        New agent
      </button>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h2>New agent</h2>
          <p>
            It starts with the standard run loop and escalation rules, and owning nothing but its own
            log and queue calls — so it cannot touch anything until you write its lane.
          </p>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Name</span>
        <span className={styles.fieldHint}>
          Lowercase, hyphenated — it appears in queue rows and in SQL the agents write, so no spaces or
          capitals. Like <code>scheduler</code> or <code>master-estimator</code>.
        </span>
        <input
          value={draft.agent_name}
          placeholder="fleet-manager"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setDraft({ ...draft, agent_name: e.target.value.toLowerCase() })}
        />
      </label>
      {nameProblem && <p className={styles.error}>{nameProblem}</p>}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Role</span>
        <span className={styles.fieldHint}>The one line that shows on its tile.</span>
        <input
          value={draft.role}
          placeholder="Equipment: what is where, what is broken, what is due for service"
          onChange={(e) => setDraft({ ...draft, role: e.target.value })}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Mandate</span>
        <span className={styles.fieldHint}>
          Optional now — one or two sentences on what it exists to do. You can write it on its page.
        </span>
        <textarea
          rows={3}
          value={draft.mandate}
          onChange={(e) => setDraft({ ...draft, mandate: e.target.value })}
        />
      </label>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button
          type="button"
          onClick={create}
          disabled={busy || !!nameProblem || !draft.agent_name.trim() || !draft.role.trim()}
        >
          {busy ? "Creating…" : "Create agent"}
        </button>
        <button type="button" className={styles.ghostButton} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
