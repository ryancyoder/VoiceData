"use client";

import { useState } from "react";
import styles from "./sales-board.module.css";
import { formatPropertyLabel, type PropertyOption } from "@/lib/salesBoard";
import { fetchWithTimeout } from "@/lib/withTimeout";

const CREATE_TIMEOUT_MS = 15000;
const NEW_PROPERTY_VALUE = "__new__";

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
// replaces that with an explicit choice: pick an existing property from the
// list, or deliberately add a new one.
export default function PropertyPicker({ id, propertyOptions, value, onChange, onCreated }: PropertyPickerProps) {
  const [creating, setCreating] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const raw = e.target.value;
    if (raw === NEW_PROPERTY_VALUE) {
      setCreating(true);
      setNewAddress("");
      setError("");
      return;
    }
    onChange(raw === "" ? null : Number(raw));
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
    <select id={id} value={value ?? ""} onChange={handleSelectChange}>
      <option value="">No property</option>
      <option value={NEW_PROPERTY_VALUE}>+ Add new property…</option>
      {propertyOptions.map((p) => (
        <option key={p.id} value={p.id}>
          {formatPropertyLabel(p)}
        </option>
      ))}
    </select>
  );
}
