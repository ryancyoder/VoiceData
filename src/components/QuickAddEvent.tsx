"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EVENT_TYPES, type EventType } from "@/lib/events";

interface Option {
  id: number;
  label: string;
  subtitle: string | null;
}

interface FormState {
  name: string;
  start: string;
  end: string;
  propertyId: number | "";
  dealId: number | "";
  eventType: EventType | "";
  notes: string;
}

// A datetime-local input value ("YYYY-MM-DDTHH:mm") built from a Date's local
// parts — matches the Calendar's create-event form.
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The event's local calendar day ("YYYY-MM-DD"), used for the deal
// appointment_date sync so it never drifts by a timezone offset.
function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function emptyForm(): FormState {
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  return { name: "", start: toLocalInput(now), end: toLocalInput(later), propertyId: "", dealId: "", eventType: "", notes: "" };
}

export default function QuickAddEvent() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deals, setDeals] = useState<Option[]>([]);
  const [properties, setProperties] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Alt/Option+E opens from anywhere (e.code so macOS Option's accent
  // character doesn't hide the "E"); Escape closes.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.code === "KeyE") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Fresh form + option lists each time it opens (so newly created deals /
  // properties are pickable without a reload).
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm(emptyForm());
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    async function load() {
      try {
        const res = await fetch("/api/search");
        const data = await res.json();
        if (!data.error) {
          setDeals(data.deals ?? []);
          setProperties(data.properties ?? []);
        }
      } catch {
        /* pickers stay empty; the event can still be created without them */
      }
    }
    load();
    requestAnimationFrame(() => firstFieldRef.current?.focus());
  }, [open]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.start || !form.end || isNaN(new Date(form.start).getTime()) || isNaN(new Date(form.end).getTime())) {
      setError("Pick a start and end time");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim() || null,
          start_time: new Date(form.start).toISOString(),
          end_time: new Date(form.end).toISOString(),
          property_id: form.propertyId === "" ? null : form.propertyId,
          deal_id: form.dealId === "" ? null : form.dealId,
          event_type: form.eventType === "" ? null : form.eventType,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add event");

      // Mirror the Calendar: an Appointment tied to a deal writes that day to
      // the deal's appointment_date. Best-effort — the event is already saved.
      if (form.dealId !== "" && form.eventType === "Appointment") {
        try {
          await fetch(`/api/sales-board/${form.dealId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appointment_date: localDateKey(new Date(form.start)) }),
          });
        } catch {
          /* non-fatal */
        }
      }

      setOpen(false);
      // Revalidate server components so an open Calendar/Next Actions reflects
      // the new event.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add event");
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";
  const label = "mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add event (⌥E)"
        aria-label="Add event"
        className="fixed bottom-[8.5rem] right-5 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-500"
      >
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="16" rx="2" />
          <path d="M3 9h18M8 2.5v4M16 2.5v4M12 12.5v5M9.5 15h5" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Quick add event</h2>
              <kbd className="hidden shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-[0.65rem] text-zinc-400 sm:inline dark:border-zinc-700">
                Esc
              </kbd>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="mb-3">
                <label className={label} htmlFor="qae-name">Title</label>
                <input
                  ref={firstFieldRef}
                  id="qae-name"
                  className={field}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Optional — e.g. Site walk"
                />
              </div>

              <div className="mb-3">
                <label className={label} htmlFor="qae-type">Type</label>
                <select id="qae-type" className={field} value={form.eventType} onChange={(e) => set("eventType", e.target.value as EventType | "")}>
                  <option value="">No type</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-3">
                <div>
                  <label className={label} htmlFor="qae-start">Start</label>
                  <input id="qae-start" type="datetime-local" className={field} value={form.start} onChange={(e) => set("start", e.target.value)} />
                </div>
                <div>
                  <label className={label} htmlFor="qae-end">End</label>
                  <input id="qae-end" type="datetime-local" className={field} value={form.end} onChange={(e) => set("end", e.target.value)} />
                </div>
              </div>

              <div className="mb-3">
                <label className={label} htmlFor="qae-property">Property</label>
                <select id="qae-property" className={field} value={form.propertyId} onChange={(e) => set("propertyId", e.target.value === "" ? "" : Number(e.target.value))}>
                  <option value="">No property</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div className="mb-3">
                <label className={label} htmlFor="qae-deal">Deal</label>
                <select id="qae-deal" className={field} value={form.dealId} onChange={(e) => set("dealId", e.target.value === "" ? "" : Number(e.target.value))}>
                  <option value="">No deal</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </div>

              <div className="mb-1">
                <label className={label} htmlFor="qae-notes">Notes</label>
                <textarea id="qae-notes" className={field} rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </div>

              {error && <div className="mt-2 text-xs text-red-500">{error}</div>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                Cancel
              </button>
              <button type="button" onClick={handleSave} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                {saving ? "Adding…" : "Add event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
