"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./calendar.module.css";
import { parseOutlookInvite } from "@/lib/parseOutlookInvite";
import { fetchWithTimeout } from "@/lib/withTimeout";
import { EVENT_TYPES, type EventType } from "@/lib/events";
import { formatPropertyLabel } from "@/lib/salesBoard";

const SUBMIT_TIMEOUT_MS = 20000;
const MATCH_FETCH_TIMEOUT_MS = 8000;

interface AddressMatch {
  id: number;
  address: string;
  contactLastName: string | null;
  distanceMeters: number;
}

interface ImportForm {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  start: string;
  end: string;
  eventType: EventType | "";
  notes: string;
}

const EMPTY_FORM: ImportForm = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  address: "",
  start: "",
  end: "",
  eventType: "Appointment",
  notes: "",
};

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ImportOutlookEvent({
  onImported,
  seed,
}: {
  onImported: (eventId: number) => void;
  // When set to a new object (e.g. from an Outlook overlay event's "make
  // appointment" button), open the modal pre-filled with this text and parse
  // it — using the given start/end as authoritative over any parsed times.
  seed?: { text: string; start?: string; end?: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [form, setForm] = useState<ImportForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressMatches, setAddressMatches] = useState<AddressMatch[]>([]);
  const [matchingAddress, setMatchingAddress] = useState(false);
  // For a seeded Outlook event, the start/end come from the event itself (its
  // body has no parseable time line). Remember them so re-pressing "Parse"
  // doesn't wipe the times.
  const seedTimesRef = useRef<{ start?: string; end?: string }>({});
  // "appointment" parses the contact/address and creates or matches a property;
  // "plain" just creates the event (no property). Toggled in the modal.
  const [mode, setMode] = useState<"appointment" | "plain">("appointment");

  function set<K extends keyof ImportForm>(key: K, value: ImportForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // The parsed address is free text and may not match how this property is
  // already stored (abbreviations, a missing zip/country, punctuation) —
  // geocoding it and checking nearby properties on file catches a match
  // that an exact string comparison would miss.
  async function checkAddressMatch(address: string) {
    const trimmed = address.trim();
    if (!trimmed) {
      setAddressMatches([]);
      return;
    }
    setMatchingAddress(true);
    try {
      const res = await fetchWithTimeout(
        "/api/properties/match-address",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: trimmed }) },
        MATCH_FETCH_TIMEOUT_MS
      );
      const data = await res.json();
      setAddressMatches(res.ok ? data.candidates ?? [] : []);
    } catch {
      /* match lookup failed or timed out — user can still save as a new property */
      setAddressMatches([]);
    } finally {
      setMatchingAddress(false);
    }
  }

  function applyMatchedAddress(match: AddressMatch) {
    set("address", match.address);
    setAddressMatches([]);
  }

  function applyParse(text: string, startOverride?: string, endOverride?: string) {
    const parsed = parseOutlookInvite(text);
    setForm({
      firstName: parsed.firstName ?? "",
      lastName: parsed.lastName ?? "",
      phone: parsed.phone ?? "",
      email: parsed.email ?? "",
      address: parsed.address ?? "",
      start: startOverride ? toDatetimeLocal(startOverride) : parsed.startTime ? toDatetimeLocal(parsed.startTime) : "",
      end: endOverride ? toDatetimeLocal(endOverride) : parsed.endTime ? toDatetimeLocal(parsed.endTime) : "",
      eventType: "Appointment",
      notes: parsed.notes,
    });
    setError(null);
    if (parsed.address) checkAddressMatch(parsed.address);
    else setAddressMatches([]);
  }

  // Open + auto-parse when the parent hands us a seeded Outlook event.
  useEffect(() => {
    if (!seed) return;
    seedTimesRef.current = { start: seed.start, end: seed.end };
    setMode("appointment");
    setOpen(true);
    setRawText(seed.text);
    applyParse(seed.text, seed.start, seed.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  function closeModal() {
    setOpen(false);
    setRawText("");
    setForm(EMPTY_FORM);
    setError(null);
    setAddressMatches([]);
    seedTimesRef.current = {};
    setMode("appointment");
  }

  async function handleCreate() {
    if (!form.start || !form.end) {
      setError("Start and end time are required — check the pasted \"Scheduled:\" line was parsed, or set them by hand.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let propertyId: number | null = null;
      const address = form.address.trim();
      if (mode === "appointment" && address) {
        const propRes = await fetchWithTimeout(
          "/api/properties",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address,
              first_name: form.firstName.trim() || undefined,
              last_name: form.lastName.trim() || undefined,
              email: form.email.trim() || undefined,
              phone: form.phone.trim() || undefined,
            }),
          },
          SUBMIT_TIMEOUT_MS
        );
        const propData = await propRes.json();
        if (!propRes.ok) throw new Error(propData.error || "Failed to create property");
        propertyId = propData.property.id as number;
      }

      const eventRes = await fetchWithTimeout(
        "/api/events",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: [form.firstName, form.lastName].filter(Boolean).join(" ") || null,
            start_time: new Date(form.start).toISOString(),
            end_time: new Date(form.end).toISOString(),
            property_id: propertyId,
            deal_id: null,
            event_type: form.eventType || null,
            notes: form.notes.trim() || null,
          }),
        },
        SUBMIT_TIMEOUT_MS
      );
      const eventData = await eventRes.json();
      if (!eventRes.ok) throw new Error(eventData.error || "Failed to create event");

      closeModal();
      onImported(eventData.event.id as number);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import event");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" className={styles["nav-btn"]} onClick={() => setOpen(true)}>
        📅 Import Outlook Event
      </button>

      {open && (
        <div
          className={styles["modal-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) closeModal();
          }}
        >
          <div className={styles["modal-panel"]}>
            <div className={styles["modal-head"]}>
              <h2 className={styles["modal-title"]}>Import Outlook event</h2>
              <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={closeModal} disabled={submitting}>
                ×
              </button>
            </div>

            <div className={styles["event-edit-form"]}>
              <div className={styles["import-mode-toggle"]}>
                <button
                  type="button"
                  className={`${styles["nav-btn"]} ${mode === "appointment" ? styles["is-active"] : ""}`}
                  onClick={() => setMode("appointment")}
                >
                  📇 Appointment
                </button>
                <button
                  type="button"
                  className={`${styles["nav-btn"]} ${mode === "plain" ? styles["is-active"] : ""}`}
                  onClick={() => {
                    setForm((f) => ({ ...f, firstName: [f.firstName, f.lastName].filter(Boolean).join(" "), lastName: "" }));
                    setMode("plain");
                  }}
                >
                  ＋ Plain event
                </button>
              </div>
              <label className={styles["event-edit-label"]}>
                Paste the calendar invite text
                <textarea
                  rows={6}
                  placeholder="Paste the text copied from the Outlook calendar event…"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={styles["nav-btn"]}
                onClick={() => applyParse(rawText, seedTimesRef.current.start, seedTimesRef.current.end)}
                disabled={!rawText.trim()}
              >
                Parse
              </button>

              <label className={styles["event-edit-label"]}>
                {mode === "plain" ? "Event name" : "First name"}
                <input type="text" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
              </label>
              {mode === "appointment" && (
                <>
                  <label className={styles["event-edit-label"]}>
                    Last name
                    <input type="text" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
                  </label>
              <label className={styles["event-edit-label"]}>
                Phone
                <input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </label>
              <label className={styles["event-edit-label"]}>
                Email
                <input type="text" inputMode="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </label>
              <label className={styles["event-edit-label"]}>
                Property address
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  onBlur={(e) => checkAddressMatch(e.target.value)}
                />
              </label>
              {matchingAddress && <div className={styles["paste-error"]}>Checking for a matching property…</div>}
              {!matchingAddress && addressMatches.length > 0 && (
                <div className={styles["bulk-match-bar"]}>
                  <span>Matches an existing property on file:</span>
                  <div className={styles["bulk-match-actions"]}>
                    {addressMatches.map((match) => (
                      <button
                        key={match.id}
                        type="button"
                        className={styles["bulk-match-btn"]}
                        onClick={() => applyMatchedAddress(match)}
                      >
                        {formatPropertyLabel(match)} · {match.distanceMeters < 1000 ? `${match.distanceMeters}m` : `${(match.distanceMeters / 1000).toFixed(1)}km`} away
                      </button>
                    ))}
                  </div>
                </div>
              )}
                </>
              )}
              <label className={styles["event-edit-label"]}>
                Start
                <input type="datetime-local" value={form.start} onChange={(e) => set("start", e.target.value)} />
              </label>
              <label className={styles["event-edit-label"]}>
                End
                <input type="datetime-local" value={form.end} onChange={(e) => set("end", e.target.value)} />
              </label>
              <label className={styles["event-edit-label"]}>
                Type
                <select value={form.eventType} onChange={(e) => set("eventType", e.target.value as EventType | "")}>
                  <option value="">No type</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles["event-edit-label"]}>
                Notes
                <textarea rows={8} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
              </label>

              {error && <div className={styles["upload-error"]}>{error}</div>}
              <div className={styles["upload-actions"]}>
                <button type="button" className={styles["card-edit-cancel"]} onClick={closeModal} disabled={submitting}>
                  Cancel
                </button>
                <button type="button" className={styles["card-edit-save"]} onClick={handleCreate} disabled={submitting}>
                  {submitting ? "Creating…" : "Create Event"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
