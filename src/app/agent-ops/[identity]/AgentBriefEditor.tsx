"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  draftFrom,
  draftsDiffer,
  fieldText,
  isListField,
  linesToList,
  type AgentPrompt,
  type BriefDraft,
  type EditableField,
} from "@/lib/agentOps";
import styles from "../agent-ops.module.css";

const BLANK: BriefDraft = {
  mandate: "",
  owned_resources: [],
  readonly_resources: [],
  run_loop: "",
  escalation_rules: "",
  handoff_rules: "",
};

const ROWS: Record<EditableField, number> = {
  mandate: 3,
  owned_resources: 7,
  readonly_resources: 7,
  run_loop: 12,
  escalation_rules: 10,
  handoff_rules: 10,
};

/** Edit one agent's brief. Pass `prompt` to edit an existing row, or
 *  `identity` alone to create the missing brief for a registered agent. */
export default function AgentBriefEditor({ prompt, identity }: { prompt?: AgentPrompt; identity?: string }) {
  const agent = prompt?.identity ?? identity ?? "";
  const saved = prompt ? draftFrom(prompt) : BLANK;

  const router = useRouter();
  const [draft, setDraft] = useState<BriefDraft>(saved);
  const [changeNote, setChangeNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  const dirty = draftsDiffer(draft, saved);

  function setField(field: EditableField, text: string) {
    setState("idle");
    setDraft((prev) => ({ ...prev, [field]: isListField(field) ? linesToList(text) : text }));
  }

  async function save() {
    setState("saving");
    setError("");
    try {
      const res = await fetch("/api/agent-ops/prompt", {
        method: prompt ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: agent, ...draft, change_note: changeNote }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Save failed");
        setState("idle");
        return;
      }
      setState("saved");
      setChangeNote("");
      // The server component re-reads the row (and its new version), so the
      // header, history and this editor's baseline all move together.
      router.refresh();
      setTimeout(() => setState("idle"), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setState("idle");
    }
  }

  return (
    <div className={styles.card}>
      {EDITABLE_FIELDS.map((field) => {
        const { label, hint } = FIELD_LABELS[field];
        const text = fieldText(draft, field);
        const changed = text !== fieldText(saved, field);
        return (
          <label key={field} className={`${styles.field} ${isListField(field) ? styles.protectedField : ""}`}>
            <span className={styles.fieldHead}>
              <strong>{label}</strong>
              {changed && <span className={styles.dirtyMark}>unsaved</span>}
            </span>
            <span className={styles.fieldHint}>{hint}</span>
            <textarea
              className={styles.textarea}
              rows={ROWS[field]}
              value={text}
              spellCheck={field === "mandate"}
              onChange={(e) => setField(field, e.target.value)}
            />
          </label>
        );
      })}

      <label className={styles.field}>
        <span className={styles.fieldHead}>
          <strong>Why this edit</strong>
        </span>
        <span className={styles.fieldHint}>
          Kept with the version snapshot. A month from now this is the only thing that explains the change.
        </span>
        <input
          className={styles.input}
          value={changeNote}
          placeholder="e.g. scheduler kept booking over Ryan's drive time"
          onChange={(e) => setChangeNote(e.target.value)}
        />
      </label>

      <div className={styles.saveBar}>
        <button type="button" onClick={save} disabled={state === "saving" || (!dirty && !!prompt)}>
          {state === "saving" ? "Saving…" : prompt ? "Save brief" : "Create brief"}
        </button>
        {dirty && (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              setDraft(saved);
              setError("");
            }}
          >
            Discard changes
          </button>
        )}
        {state === "saved" && <span className={styles.saveState}>Saved ✓ live on the next session</span>}
        {error && <span className={styles.saveError}>{error}</span>}
      </div>
    </div>
  );
}
