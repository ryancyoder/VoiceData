"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BRIEF_FIELDS,
  changedFields,
  fieldLabel,
  listToText,
  textToList,
  type AgentPrompt,
  type AgentPromptVersion,
  type BriefField,
} from "@/lib/agentPrompts";

// Every field of the brief is editable here, because every rule in this system
// needs to be changeable from a phone. Save writes the row; the snapshot that
// makes a bad edit recoverable is written by a database trigger.

type Draft = Record<BriefField, string>;

function toDraft(source: Pick<AgentPrompt, BriefField>): Draft {
  return {
    mandate: source.mandate ?? "",
    owned_resources: listToText(source.owned_resources),
    readonly_resources: listToText(source.readonly_resources),
    run_loop: source.run_loop ?? "",
    escalation_rules: source.escalation_rules ?? "",
    handoff_rules: source.handoff_rules ?? "",
  };
}

function draftToPayload(draft: Draft) {
  return {
    mandate: draft.mandate,
    owned_resources: textToList(draft.owned_resources),
    readonly_resources: textToList(draft.readonly_resources),
    run_loop: draft.run_loop,
    escalation_rules: draft.escalation_rules,
    handoff_rules: draft.handoff_rules,
  };
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AgentBriefEditor({
  prompt,
  versions,
}: {
  prompt: AgentPrompt;
  versions: AgentPromptVersion[];
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<AgentPrompt>(prompt);
  const [draft, setDraft] = useState<Draft>(() => toDraft(prompt));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openVersion, setOpenVersion] = useState<number | null>(null);

  const savedDraft = useMemo(() => toDraft(saved), [saved]);
  const dirty = BRIEF_FIELDS.some((f) => draft[f.key] !== savedDraft[f.key]);

  function set(key: BriefField, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent-ops/prompts/${saved.identity}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draftToPayload(draft), change_note: note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSaved(data.prompt as AgentPrompt);
      setDraft(toDraft(data.prompt as AgentPrompt));
      setNote("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Rolling back loads the old version into the form. It is not written until
  // Save, so a mistaken restore costs nothing — and the rollback itself becomes
  // a new version rather than erasing the one it replaced.
  function restore(version: AgentPromptVersion) {
    setDraft(toDraft(version));
    setNote(`Rolled back to v${version.version}`);
    setError(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          v{saved.version}
        </span>
        <span>edited {when(saved.updated_at)}</span>
        {saved.updated_by ? <span>by {saved.updated_by}</span> : null}
        {saved.change_note ? <span className="italic">“{saved.change_note}”</span> : null}
      </div>

      {BRIEF_FIELDS.map((field) => (
        <div key={field.key}>
          <label
            htmlFor={field.key}
            className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          >
            {field.label}
          </label>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{field.hint}</p>
          <textarea
            id={field.key}
            value={draft[field.key]}
            onChange={(e) => set(field.key, e.target.value)}
            rows={field.rows}
            spellCheck={false}
            className="mt-2 w-full rounded-lg border border-zinc-200 bg-white p-3 font-mono text-[13px] leading-relaxed text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-600"
          />
        </div>
      ))}

      <div className="sticky bottom-0 -mx-4 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 dark:border-zinc-800 dark:bg-zinc-950/95">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What changed, and why (optional)"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-600"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? "Saving…" : dirty ? "Save brief" : "Saved"}
          </button>
          {dirty ? (
            <button
              type="button"
              onClick={() => {
                setDraft(savedDraft);
                setNote("");
                setError(null);
              }}
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Discard
            </button>
          ) : null}
          {error ? <span className="text-sm text-red-600 dark:text-red-400">{error}</span> : null}
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">History</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Every save is snapshotted. Open one to see what it changed, or load it back into the form.
        </p>
        <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {versions.map((version, index) => {
            const previous = versions[index + 1];
            const diff = previous ? changedFields(version, previous) : [];
            const open = openVersion === version.version;
            return (
              <li key={version.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenVersion(open ? null : version.version)}
                    className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
                  >
                    v{version.version}
                  </button>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{when(version.created_at)}</span>
                  {version.change_note ? (
                    <span className="text-xs italic text-zinc-500 dark:text-zinc-400">
                      “{version.change_note}”
                    </span>
                  ) : null}
                  {version.version !== saved.version ? (
                    <button
                      type="button"
                      onClick={() => restore(version)}
                      className="ml-auto text-xs text-zinc-500 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      Load into form
                    </button>
                  ) : (
                    <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">current</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {previous
                    ? diff.length
                      ? `Changed: ${diff.map(fieldLabel).join(", ")}`
                      : "No brief fields changed"
                    : "First version"}
                </p>
                {open ? (
                  <dl className="mt-2 space-y-2">
                    {BRIEF_FIELDS.map((field) => (
                      <div key={field.key}>
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                          {field.label}
                        </dt>
                        <dd className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {field.kind === "list"
                            ? listToText(version[field.key] as string[])
                            : (version[field.key] as string)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
