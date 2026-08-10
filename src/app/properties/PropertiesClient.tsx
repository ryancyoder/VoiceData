"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import styles from "./properties.module.css";
import { fetchWithTimeout } from "@/lib/withTimeout";
import { STAGES, type Stage } from "@/lib/salesBoard";
import type { PropertyRow } from "./page";

const STAGE_COLORS: Record<Stage, string> = {
  Lead: "var(--c-lead)",
  Propose: "var(--c-propose)",
  Sent: "var(--c-send)",
  Sold: "var(--c-sold)",
  "Project Management": "var(--c-pm)",
  "Job Costing": "var(--c-jobcosting)",
  Invoiced: "var(--c-invoiced)",
  "Paid in Full": "var(--c-paid)",
};

const PropertyMap = dynamic(() => import("./PropertyMap"), {
  ssr: false,
  loading: () => <div className={styles.empty}>Loading map…</div>,
});

const SetLocationModal = dynamic(() => import("./SetLocationModal"), { ssr: false });

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
  const searchParams = useSearchParams();
  // Sorted here rather than trusted from the server response — keeps the
  // table correctly ordered even if the initial fetch's own ordering
  // doesn't come back exactly right.
  const [properties, setProperties] = useState<PropertyRow[]>(() =>
    [...initialProperties].sort(comparePropertiesByLastName)
  );
  const [view, setView] = useState<"table" | "map">("table");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [highlightedPropertyId, setHighlightedPropertyId] = useState<number | null>(null);
  const [locationModalPropertyId, setLocationModalPropertyId] = useState<number | null>(null);

  // Centers the manual location picker on wherever this business's other
  // properties already are, rather than defaulting to the middle of the
  // country — much less panning to find the right neighborhood.
  const defaultMapCenter = useMemo<[number, number] | null>(() => {
    const geocoded = properties.filter((p) => p.latitude != null && p.longitude != null);
    if (geocoded.length === 0) return null;
    return [
      geocoded.reduce((sum, p) => sum + p.latitude!, 0) / geocoded.length,
      geocoded.reduce((sum, p) => sum + p.longitude!, 0) / geocoded.length,
    ];
  }, [properties]);

  function handleLocationSaved(propertyId: number, latitude: number, longitude: number) {
    setProperties((ps) =>
      ps.map((p) => (p.id === propertyId ? { ...p, latitude, longitude, geocoded_at: new Date().toISOString() } : p))
    );
    setLocationModalPropertyId(null);
  }

  // All stages selected is the neutral/unfiltered state — every property
  // shows, including ones with no deal at all. Deselecting a stage narrows
  // to properties that have a deal in one of the stages still selected, so
  // a property with no deals naturally drops out once the filter is
  // actually doing something.
  const [selectedStages, setSelectedStages] = useState<Set<Stage>>(() => new Set(STAGES));
  function toggleStage(stage: Stage) {
    setSelectedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }
  const visibleProperties = useMemo(() => {
    if (selectedStages.size === STAGES.length) return properties;
    return properties.filter((p) => p.dealStages.some((s) => selectedStages.has(s)));
  }, [properties, selectedStages]);

  // Reacts to the URL's ?property= param (the command palette navigates
  // here this way) rather than only reading it once on mount, so it also
  // fires for a second search while this page is already open. Clearing
  // the stage filter guarantees the target row is actually in
  // visibleProperties — a search result that silently failed to scroll
  // anywhere because of a filter the user forgot was on would be worse
  // than just resetting it. The state resets are plain render-time
  // adjustments (tracked via lastSearchParams, compared by reference since
  // useSearchParams() returns a new object on every navigation); only the
  // actual scroll/timer side effects below need a real useEffect.
  const [lastSearchParams, setLastSearchParams] = useState<typeof searchParams | null>(null);
  if (searchParams !== lastSearchParams) {
    setLastSearchParams(searchParams);
    const propertyParam = searchParams.get("property");
    const propertyId = propertyParam ? Number(propertyParam) : NaN;
    if (Number.isFinite(propertyId)) {
      setView("table");
      setSelectedStages(new Set(STAGES));
      setHighlightedPropertyId(propertyId);
    }
  }

  useEffect(() => {
    if (highlightedPropertyId == null) return;
    requestAnimationFrame(() => {
      document.querySelector(`[data-property-row="${highlightedPropertyId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const timer = setTimeout(() => setHighlightedPropertyId(null), 2500);
    return () => clearTimeout(timer);
  }, [highlightedPropertyId]);

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
      setProperties((ps) =>
        [...ps, { ...created, dealCount: 0, eventCount: 0, dealStages: [] }].sort(comparePropertiesByLastName)
      );
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
            {visibleProperties.length === properties.length
              ? `${properties.length} propert${properties.length === 1 ? "y" : "ies"}`
              : `${visibleProperties.length} of ${properties.length} propert${properties.length === 1 ? "y" : "ies"}`}
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

      <div className={styles["stage-filter-bar"]}>
        {STAGES.map((stage) => {
          const active = selectedStages.has(stage);
          return (
            <button
              key={stage}
              type="button"
              className={`${styles["stage-filter-chip"]} ${active ? styles["is-active"] : ""}`}
              style={{ ["--chip-color" as string]: STAGE_COLORS[stage] }}
              onClick={() => toggleStage(stage)}
              aria-pressed={active}
            >
              {stage}
            </button>
          );
        })}
        <span className={styles["stage-filter-actions"]}>
          <button type="button" className={styles["stage-filter-link"]} onClick={() => setSelectedStages(new Set(STAGES))}>
            All
          </button>
          <button type="button" className={styles["stage-filter-link"]} onClick={() => setSelectedStages(new Set())}>
            None
          </button>
        </span>
      </div>

      <div className={styles.content}>
        {properties.length === 0 ? (
          <div className={styles.empty}>No properties yet. Add one to get started.</div>
        ) : visibleProperties.length === 0 ? (
          <div className={styles.empty}>No properties match the selected pipeline stages.</div>
        ) : view === "map" ? (
          <PropertyMap properties={visibleProperties} />
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
                {visibleProperties.map((p) => (
                  <tr
                    key={p.id}
                    data-property-row={p.id}
                    className={p.id === highlightedPropertyId ? styles["is-highlighted"] : ""}
                  >
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
                        <>
                          <span className={styles["geocode-no"]}>Not geocoded</span>{" "}
                          <button
                            type="button"
                            className={styles["geocode-set-link"]}
                            onClick={() => setLocationModalPropertyId(p.id)}
                          >
                            Set location
                          </button>
                        </>
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

      {locationModalPropertyId != null && (() => {
        const property = properties.find((p) => p.id === locationModalPropertyId);
        if (!property) return null;
        return (
          <SetLocationModal
            propertyId={property.id}
            address={property.address}
            initialLatitude={property.latitude}
            initialLongitude={property.longitude}
            defaultCenter={defaultMapCenter}
            onClose={() => setLocationModalPropertyId(null)}
            onSaved={(latitude, longitude) => handleLocationSaved(property.id, latitude, longitude)}
          />
        );
      })()}
    </div>
  );
}
