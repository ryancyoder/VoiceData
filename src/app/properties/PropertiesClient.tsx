"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import styles from "./properties.module.css";
import { fetchWithTimeout } from "@/lib/withTimeout";
import type { PropertyRow } from "./page";

const PropertyMap = dynamic(() => import("./PropertyMap"), {
  ssr: false,
  loading: () => <div className={styles.empty}>Loading map…</div>,
});

const SUBMIT_TIMEOUT_MS = 15000;

const EMPTY_FORM = { address: "", first_name: "", last_name: "", email: "", phone: "" };

// Mirrors the server-side order (contacts.last_name, then address as a
// tiebreaker) so a freshly-added property lands in the right spot locally
// without needing a full refetch. Properties with no contact yet sort last,
// matching Postgres' default NULLS LAST for ascending order.
function comparePropertiesByLastName(a: PropertyRow, b: PropertyRow): number {
  const aLast = a.contact?.last_name?.trim() ?? "";
  const bLast = b.contact?.last_name?.trim() ?? "";
  if (!aLast && !bLast) return a.address.localeCompare(b.address);
  if (!aLast) return 1;
  if (!bLast) return -1;
  const cmp = aLast.localeCompare(bLast, undefined, { sensitivity: "base" });
  return cmp !== 0 ? cmp : a.address.localeCompare(b.address);
}

export default function PropertiesClient({ properties: initialProperties }: { properties: PropertyRow[] }) {
  const [properties, setProperties] = useState<PropertyRow[]>(initialProperties);
  const [view, setView] = useState<"table" | "map">("table");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function closeForm() {
    setFormOpen(false);
    setForm(EMPTY_FORM);
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const address = form.address.trim();
    if (!address) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetchWithTimeout(
        "/api/properties",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            first_name: form.first_name.trim() || undefined,
            last_name: form.last_name.trim() || undefined,
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
          }),
        },
        SUBMIT_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add property");
      const created = data.property as PropertyRow;
      setProperties((ps) => [...ps, { ...created, dealCount: 0, eventCount: 0 }].sort(comparePropertiesByLastName));
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add property");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <h1>Properties</h1>
          <p>
            {properties.length} propert{properties.length === 1 ? "y" : "ies"} ·{" "}
            <Link href="/sales-board" className={styles["brand-back"]}>
              Sales Board
            </Link>{" "}
            ·{" "}
            <Link href="/calendar" className={styles["brand-back"]}>
              Calendar
            </Link>{" "}
            ·{" "}
            <Link href="/photos" className={styles["brand-back"]}>
              Photos
            </Link>
          </p>
        </div>
        <div className={styles.toolbar}>
          <div className={styles["view-toggle"]}>
            <button
              type="button"
              className={`${styles["view-toggle-btn"]} ${view === "table" ? styles["is-active"] : ""}`}
              onClick={() => setView("table")}
            >
              Table
            </button>
            <button
              type="button"
              className={`${styles["view-toggle-btn"]} ${view === "map" ? styles["is-active"] : ""}`}
              onClick={() => setView("map")}
            >
              Map
            </button>
          </div>
          <button type="button" className={styles["nav-btn"]} onClick={() => setFormOpen(true)}>
            + Add Property
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {properties.length === 0 ? (
          <div className={styles.empty}>No properties yet. Add one to get started.</div>
        ) : view === "map" ? (
          <PropertyMap properties={properties} />
        ) : (
          <div className={styles["table-wrap"]}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Last Name</th>
                  <th>Address</th>
                  <th>Contact</th>
                  <th>Deals</th>
                  <th>Events</th>
                  <th>Geocoded</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <tr key={p.id}>
                    <td className={styles["contact-name"]}>{p.contact?.last_name || <span className={styles["no-contact"]}>—</span>}</td>
                    <td className={styles["address-cell"]}>{p.address}</td>
                    <td>
                      {p.contact ? (
                        <>
                          {p.contact.first_name && <div>{p.contact.first_name}</div>}
                          {p.contact.email && <div className={styles["contact-detail"]}>{p.contact.email}</div>}
                          {p.contact.phone && <div className={styles["contact-detail"]}>{p.contact.phone}</div>}
                        </>
                      ) : (
                        <span className={styles["no-contact"]}>No contact</span>
                      )}
                    </td>
                    <td>
                      <span className={styles["count-pill"]}>{p.dealCount}</span>
                    </td>
                    <td>
                      <span className={styles["count-pill"]}>{p.eventCount}</span>
                    </td>
                    <td>
                      {p.latitude != null && p.longitude != null ? (
                        <span className={styles["geocode-yes"]}>✓ Geocoded</span>
                      ) : (
                        <span className={styles["geocode-no"]}>Not geocoded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && (
        <div
          className={styles["modal-overlay"]}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) closeForm();
          }}
        >
          <div className={styles["modal-panel"]}>
            <div className={styles["modal-head"]}>
              <h2 className={styles["modal-title"]}>Add property</h2>
              <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={closeForm} disabled={submitting}>
                ×
              </button>
            </div>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label htmlFor="prop-address">Address</label>
                <input
                  id="prop-address"
                  required
                  autoComplete="off"
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </div>
              <div className={styles["field-row"]}>
                <div className={styles.field}>
                  <label htmlFor="prop-first">Contact first name</label>
                  <input id="prop-first" autoComplete="off" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label htmlFor="prop-last">Contact last name</label>
                  <input id="prop-last" autoComplete="off" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
                </div>
              </div>
              <div className={styles["field-row"]}>
                <div className={styles.field}>
                  <label htmlFor="prop-email">Contact email</label>
                  <input id="prop-email" type="text" inputMode="email" autoComplete="off" value={form.email} onChange={(e) => set("email", e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label htmlFor="prop-phone">Contact phone</label>
                  <input id="prop-phone" type="tel" autoComplete="off" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                </div>
              </div>
              {error && <div className={styles["form-error"]}>{error}</div>}
              <div className={styles["form-actions"]}>
                <button type="button" className={styles["btn-cancel"]} onClick={closeForm} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className={styles["btn-submit"]} disabled={submitting || !form.address.trim()}>
                  {submitting ? "Adding…" : "Add Property"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
