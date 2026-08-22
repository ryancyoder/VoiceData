"use client";

import { useState } from "react";
import styles from "../../agentOps.module.css";

// Copies everything a fresh session needs to be app-developer working on this
// app: the brief, the house rules, and this app's own record and docs.
//
// The markdown is fetched on click rather than baked into the page, so what
// lands on the clipboard is what the documents say now.
export default function CopyAppBrief({ appId, appName }: { appId: number; appName: string }) {
  const [state, setState] = useState<"idle" | "working" | "copied">("idle");
  const [error, setError] = useState("");
  const [fallback, setFallback] = useState("");

  async function copy() {
    setState("working");
    setError("");
    setFallback("");
    try {
      const res = await fetch(`/api/agent-ops/apps/${appId}/brief`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not build the brief");

      const markdown = data.markdown as string;
      try {
        await navigator.clipboard.writeText(markdown);
        setState("copied");
        setTimeout(() => setState("idle"), 2500);
      } catch {
        // Clipboard access is refused in plenty of ordinary situations on a
        // phone. Show the text instead of failing.
        setFallback(markdown);
        setState("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the brief");
      setState("idle");
    }
  }

  return (
    <div className={styles.copyBrief}>
      <button type="button" className={styles.ghostButton} onClick={copy} disabled={state === "working"}>
        {state === "copied" ? "Copied ✓" : state === "working" ? "Building…" : "Copy brief"}
      </button>
      <span className={styles.fieldHint}>
        The agent brief plus everything about {appName} — paste it into a new session to start work on it.
      </span>
      {error && <p className={styles.error}>{error}</p>}
      {fallback && (
        <textarea
          className={styles.copyFallback}
          readOnly
          rows={10}
          value={fallback}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </div>
  );
}
