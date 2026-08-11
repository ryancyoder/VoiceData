"use client";

import { useState } from "react";
import styles from "./sales-board.module.css";
import { formatPropertyLabel, type PropertyOption } from "@/lib/salesBoard";
import { fetchWithTimeout } from "@/lib/withTimeout";

const CREATE_TIMEOUT_MS = 15000;

interface PropertyPickerProps {
  id?: string;
  propertyOptions: PropertyOption[];
  value: number | null;
  onChange: (propertyId: number | null) => void;
  onCreated: (option: PropertyOption) => void;
}

// A property's address is looked up, never freely typed — typing it in and
// saving used to silently create a near-duplicate property whenever the
// text didn't exactly match what was on file (worse still when geocoding
// failed, since that also skipped the proximity-based dedupe check). This
// gives an explicit choice: search and match an existing property, or
// deliberately add a new one.
export default function PropertyPicker({ id, propertyOptions, value, onChange, onCreated }: PropertyPickerProps) {
  const [creating, setCreating] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Search-and-match state.
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selected = value != null ? propertyOptions.find((p) => p.id === value) ?? null : null;
  const q = query.trim().toLowerCase();
  const filtered = (q ? propertyOptions.filter((p) => formatPropertyLabel(p).toLowerCase().includes(q)) : propertyOptions).slice(0, 50);

  function startCreate(prefill: string) {
    setCreating(true);
    setNewAddress(prefill);
    setError("");
    setOpen(false);
  }

  function cancelCreate() {
    setCreating(false);
    setNewAddress("");
    setError("");
  }

  async function handleCreate() {
    const address = newAddress.trim();
    if (!address) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetchWithTimeout(
        "/api/properties",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) },
        CREATE_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add property");
      const created = data.property as { id: number; address: string };
      onCreated({ id: created.id, address: created.address, contactLastName: null });
      onChange(created.id);
      setCreating(false);
      setNewAddress("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add property");
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <div className={styles["property-picker-new"]}>
        <input
          id={id}
          autoFocus
          autoComplete="off"
          placeholder="New property address"
          value={newAddress}
          onChange={(e) => setNewAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreate();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelCreate();
            }
          }}
          disabled={busy}
        />
        <button type="button" className={styles["refresh-btn"]} onClick={handleCreate} disabled={busy || !newAddress.trim()}>
          {busy ? "Adding…" : "Add property"}
        </button>
        <button type="button" className={styles["refresh-btn"]} onClick={cancelCreate} disabled={busy}>
          Cancel
        </button>
        {error && <div className={styles["form-error"]}>{error}</div>}
      </div>
    );
  }

  return (
    <div className={styles["property-picker"]}>
      <input
        id={id}
        autoComplete="off"
        placeholder="Search a jobsite address to match…"
        value={open ? query : selected ? formatPropertyLabel(selected) : ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            if (filtered.length > 0) {
              onChange(filtered[0].id);
              setOpen(false);
            } else if (query.trim()) {
              startCreate(query.trim());
            }
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {selected && !open && (
        <button
          type="button"
          className={styles["property-picker-clear"]}
          aria-label="Clear property"
          onClick={() => onChange(null)}
        >
          ✕
        </button>
      )}
      {open && (
        <ul className={styles["property-picker-menu"]}>
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={styles["property-picker-item"]}
                // onMouseDown (not onClick) so the pick lands before the input's blur closes the menu.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                {formatPropertyLabel(p)}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className={styles["property-picker-empty"]}>No matching property</li>}
          <li>
            <button
              type="button"
              className={`${styles["property-picker-item"]} ${styles["property-picker-add"]}`}
              onMouseDown={(e) => {
                e.preventDefault();
                startCreate(query.trim());
              }}
            >
              + Add new property{query.trim() ? ` “${query.trim()}”` : "…"}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
