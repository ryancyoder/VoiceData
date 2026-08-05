"use client";

import { useEffect, useState } from "react";
import styles from "./sales-board.module.css";
import { dealPhotoUrl, type Deal, type DealInput } from "@/lib/salesBoard";

interface DealModalProps {
  deal: Deal;
  onClose: () => void;
  onSave: (id: number, updates: Partial<DealInput>) => Promise<void>;
  onDelete: (deal: Deal) => void;
  onToggleLost: (deal: Deal) => Promise<void>;
  onUploadPhoto: (dealId: number, file: File) => Promise<void>;
  onDeletePhoto: (dealId: number, photoId: number) => Promise<void>;
}

function formatDateTime(isoStr: string) {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DealModal({
  deal,
  onClose,
  onSave,
  onDelete,
  onToggleLost,
  onUploadPhoto,
  onDeletePhoto,
}: DealModalProps) {
  const [form, setForm] = useState({
    deal_name: deal.deal_name || "",
    company: deal.company || "",
    value: deal.value != null ? String(deal.value) : "",
    contact_first_name: deal.contact_first_name || "",
    contact_last_name: deal.contact_last_name || "",
    contact_email: deal.contact_email || "",
    contact_phone: deal.contact_phone || "",
    proposal_number: deal.proposal_number || "",
    proposal_date: deal.proposal_date || "",
    appointment_date: deal.appointment_date || "",
    jobsite_address: deal.jobsite_address || "",
    next_action: deal.next_action || "",
    proposal_description: deal.proposal_description || "",
  });
  const [saving, setSaving] = useState(false);
  const [lostBusy, setLostBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.deal_name.trim();
    if (!name) return;
    setSaving(true);
    setError("");
    try {
      await onSave(deal.id, {
        deal_name: name,
        company: form.company.trim() || null,
        value: form.value ? Number(form.value) : null,
        contact_first_name: form.contact_first_name.trim() || null,
        contact_last_name: form.contact_last_name.trim() || null,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        proposal_number: form.proposal_number.trim() || null,
        proposal_date: form.proposal_date || null,
        appointment_date: form.appointment_date || null,
        jobsite_address: form.jobsite_address.trim() || null,
        next_action: form.next_action.trim() || null,
        proposal_description: form.proposal_description.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save — try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleLost() {
    setLostBusy(true);
    try {
      await onToggleLost(deal);
      onClose();
    } finally {
      setLostBusy(false);
    }
  }

  return (
    <div
      className={styles["modal-overlay"]}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles["modal-panel"]} role="dialog" aria-modal="true">
        <div className={styles["modal-head"]}>
          <div>
            <h2 className={styles["modal-title"]}>{deal.deal_name}</h2>
            <span className={styles["modal-stage"]}>
              {deal.lost_at ? `${deal.stage} · Lost ${formatDateTime(deal.lost_at)}` : deal.stage}
            </span>
          </div>
          <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <form className={styles["card-edit-form"]} onSubmit={handleSubmit}>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-name">Deal name</label>
            <input
              id="dm-name"
              required
              maxLength={120}
              autoComplete="off"
              value={form.deal_name}
              onChange={(e) => set("deal_name", e.target.value)}
            />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-company">Company</label>
            <input id="dm-company" autoComplete="off" value={form.company} onChange={(e) => set("company", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-value">Value ($)</label>
            <input id="dm-value" type="number" min="0" step="1" value={form.value} onChange={(e) => set("value", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-first">Contact first name</label>
            <input id="dm-first" autoComplete="off" value={form.contact_first_name} onChange={(e) => set("contact_first_name", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-last">Contact last name</label>
            <input id="dm-last" autoComplete="off" value={form.contact_last_name} onChange={(e) => set("contact_last_name", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-email">Contact email</label>
            <input id="dm-email" type="email" autoComplete="off" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-phone">Contact phone</label>
            <input id="dm-phone" type="tel" autoComplete="off" value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-proposal-number">Proposal #</label>
            <input id="dm-proposal-number" autoComplete="off" value={form.proposal_number} onChange={(e) => set("proposal_number", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-proposal-date">Proposal date</label>
            <input id="dm-proposal-date" type="date" value={form.proposal_date} onChange={(e) => set("proposal_date", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-appointment-date">Appointment date</label>
            <input id="dm-appointment-date" type="date" value={form.appointment_date} onChange={(e) => set("appointment_date", e.target.value)} />
          </div>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-jobsite">Jobsite address</label>
            <input id="dm-jobsite" autoComplete="off" value={form.jobsite_address} onChange={(e) => set("jobsite_address", e.target.value)} />
          </div>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-next-action">Next action</label>
            <input id="dm-next-action" autoComplete="off" value={form.next_action} onChange={(e) => set("next_action", e.target.value)} />
          </div>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-description">Proposal description</label>
            <textarea id="dm-description" rows={3} value={form.proposal_description} onChange={(e) => set("proposal_description", e.target.value)} />
          </div>

          <div className={`${styles["photo-row"]}`}>
            {deal.photos.map((photo) => (
              <div key={photo.id} className={styles["photo-thumb"]}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={dealPhotoUrl(photo.storage_path)} alt={photo.caption ?? deal.deal_name} />
                <button
                  type="button"
                  className={styles["photo-remove"]}
                  aria-label="Delete photo"
                  onClick={() => onDeletePhoto(deal.id, photo.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <label className={styles["photo-add"]}>
              + Photo
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) {
                    Array.from(files).forEach((file) => onUploadPhoto(deal.id, file));
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {error && <div className={styles["card-edit-error"]}>{error}</div>}

          <div className={styles["modal-actions"]}>
            <div className={styles["modal-actions-left"]}>
              <button type="button" className={styles["modal-delete"]} onClick={() => onDelete(deal)}>
                Delete deal
              </button>
              <button
                type="button"
                className={`${styles["modal-lost"]} ${deal.lost_at ? styles["is-restore"] : ""}`}
                disabled={lostBusy}
                onClick={handleToggleLost}
              >
                {deal.lost_at ? "Restore to pipeline" : "Mark as Lost"}
              </button>
            </div>
            <div className={styles["modal-actions-right"]}>
              <button type="button" className={styles["card-edit-cancel"]} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={styles["card-edit-save"]} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
