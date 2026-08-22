"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  parseResource,
  type AgentBriefDraft,
  type AgentPromptRow,
  type AgentPromptVersionRow,
} from "@/lib/agentOps";

// Resource lists are edited one-per-line: it is the only shape that stays
// workable on a phone. The chips underneath re-parse what was typed, so a
// missing prefix or a stray line is visible before it is saved.
const KIND_STYLES: Record<string, string> = {
  table: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  view: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  fn: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  calendar: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  bucket: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  connector: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  note: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const EMPTY: AgentBriefDraft = {
  mandate: "",
  owned_resources: [],
  readonly_resources: [],
  run_loop: "",
  escalation_rules: "",
  handoff_rules: "",
};

function toLines(list: string[]): string {
  return list.join("\n");
}

function fromLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function fmt(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function Field({
  label,
  hint,
  value,
  rows,
  mono,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  rows: number;
  mono?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
      <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-2 w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600 ${
          mono ? "font-mono text-[13px]" : ""
        }`}
      />
    </label>
  );
}

function ResourceField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const parsed = useMemo(() => fromLines(value).map(parseResource), [value]);
  return (
    <div>
      <Field label={label} hint={hint} value={value} rows={Math.max(4, fromLines(value).length + 1)} mono onChange={onChange} />
      {parsed.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parsed.map((r, i) => (
            <span
              key={`${r.name}-${i}`}
              title={r.scope ?? undefined}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${KIND_STYLES[r.kind] ?? KIND_STYLES.note}`}
            >
              {r.kind === "note" ? r.name : `${r.kind}:${r.name}`}
              {r.scope ? " *" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentBriefEditor({
  identity,
  prompt,
  versions,
}: {
  identity: string;
  prompt: AgentPromptRow | null;
  versions: AgentPromptVersionRow[];
}) {
  const router = useRouter();
  const initial: AgentBriefDraft = prompt
    ? {
        mandate: prompt.mandate,
        owned_resources: prompt.owned_resources,
        readonly_resources: prompt.readonly_resources,
        run_loop: prompt.run_loop,
        escalation_rules: prompt.escalation_rules,
        handoff_rules: prompt.handoff_rules,
      }
    : EMPTY;

  const [mandate, setMandate] = useState(initial.mandate);
  const [owned, setOwned] = useState(toLines(initial.owned_resources));
  const [readonly, setReadonly] = useState(toLines(initial.readonly_resources));
  const [runLoop, setRunLoop] = useState(initial.run_loop);
  const [escalation, setEscalation] = useState(initial.escalation_rules);
  const [handoff, setHandoff] = useState(initial.handoff_rules);
  const [changeNote, setChangeNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<number | null>(null);

  const dirty =
    mandate !== initial.mandate ||
    owned !== toLines(initial.owned_resources) ||
    readonly !== toLines(initial.readonly_resources) ||
    runLoop !== initial.run_loop ||
    escalation !== initial.escalation_rules ||
    handoff !== initial.handoff_rules;

  async function save() {
    setState("saving");
    setError(null);
    try {
      const res = await fetch(`/api/agent-ops/prompts/${encodeURIComponent(identity)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mandate,
          owned_resources: fromLines(owned),
          readonly_resources: fromLines(readonly),
          run_loop: runLoop,
          escalation_rules: escalation,
          handoff_rules: handoff,
          change_note: changeNote.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setState("saved");
      setChangeNote("");
      setLoadedFrom(null);
      router.refresh();
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setState("idle");
    }
  }

  // Loading an old version fills the form but does not write anything — a
  // rollback is an ordinary save of that text, so it gets a version of its own
  // and the history stays append-only.
  async function loadVersion(version: number) {
    setError(null);
    try {
      const res = await fetch(
        `/api/agent-ops/prompts/${encodeURIComponent(identity)}?version=${version}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load that version");
      setMandate(data.mandate ?? "");
      setOwned(toLines(data.owned_resources ?? []));
      setReadonly(toLines(data.readonly_resources ?? []));
      setRunLoop(data.run_loop ?? "");
      setEscalation(data.escalation_rules ?? "");
      setHandoff(data.handoff_rules ?? "");
      setChangeNote(`Rolled back to v${version}`);
      setLoadedFrom(version);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that version");
    }
  }

  return (
    <div className="space-y-6">
      {!prompt && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          This agent is registered but has no brief yet. Fill these in and save to create one.
        </div>
      )}

      {loadedFrom !== null && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
          Loaded v{loadedFrom} into the form. Nothing is written until you save — saving files it as a new version.
        </div>
      )}

      <Field
        label="Mandate"
        hint="One or two sentences: what this agent exists to do."
        value={mandate}
        rows={3}
        onChange={setMandate}
      />

      <ResourceField
        label="Owned resources"
        hint="What it may WRITE — one per line. Prefix each: table: view: fn: calendar: bucket: connector:. A parenthetical narrows the grant. This list is what prevents damage; keep it exact."
        value={owned}
        onChange={setOwned}
      />

      <ResourceField
        label="Read-only resources"
        hint="What it may read but never touch — one per line, same prefixes."
        value={readonly}
        onChange={setReadonly}
      />

      <Field
        label="Run loop"
        hint="The literal claim → work → complete sequence."
        value={runLoop}
        rows={14}
        mono
        onChange={setRunLoop}
      />

      <Field
        label="Escalation rules"
        hint="When to write a Human Action Inbox item instead of proceeding."
        value={escalation}
        rows={10}
        onChange={setEscalation}
      />

      <Field
        label="Handoff rules"
        hint="Which agents it may enqueue for, and the payload shape each expects. Vague rules here are where garbage queue rows come from."
        value={handoff}
        rows={12}
        mono
        onChange={setHandoff}
      />

      <div className="sticky bottom-0 -mx-4 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 dark:border-zinc-800 dark:bg-zinc-950/95">
        <input
          type="text"
          value={changeNote}
          placeholder="What changed, and why (optional)"
          onChange={(e) => setChangeNote(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={state === "saving" || (!dirty && state !== "saved")}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {state === "saved" ? "Saved ✓" : state === "saving" ? "Saving…" : "Save brief"}
          </button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {prompt ? `v${prompt.version}` : "unsaved"}
            {dirty ? " · unsaved changes" : ""}
          </span>
        </div>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {versions.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">History</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Every state this brief has been in. Load one to diff or roll back.
          </p>
          <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">v{v.version}</span>
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{fmt(v.created_at)}</span>
                  {v.change_note && (
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{v.change_note}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => loadVersion(v.version)}
                  className="shrink-0 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Load
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
