"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./sales-board.module.css";
import PropertyPicker from "./PropertyPicker";
import { dealAttachmentUrl, dealDocumentUrl, dealThumbUrl, type Deal, type DealInput, type PropertyOption } from "@/lib/salesBoard";
import { fetchWithTimeout } from "@/lib/withTimeout";

const PARSE_ASPIRE_TIMEOUT_MS = 25000;

interface DealModalProps {
  deal: Deal;
  relatedDeals: Deal[];
  propertyOptions: PropertyOption[];
  onPropertyCreated: (option: PropertyOption) => void;
  onSelectDeal: (id: number) => void;
  onClose: () => void;
  onSave: (id: number, updates: Partial<DealInput>) => Promise<void>;
  onDelete: (deal: Deal) => void;
  onToggleLost: (deal: Deal) => Promise<void>;
  onUploadPhoto: (dealId: number, file: File) => Promise<void>;
  onDeletePhoto: (dealId: number, photoId: number) => Promise<void>;
  onUploadProposalPdf: (dealId: number, file: File) => Promise<void>;
  onDeleteProposalPdf: (dealId: number) => Promise<void>;
  onUploadAttachment: (dealId: number, file: File) => Promise<void>;
  onDeleteAttachment: (dealId: number, attachmentId: number) => Promise<void>;
}

function formatDateTime(isoStr: string) {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function GeocodeStatus({ deal }: { deal: Deal }) {
  const property = deal.property;
  if (!property) return null;

  if (property.latitude != null && property.longitude != null) {
    const mapUrl = `https://www.google.com/maps?q=${property.latitude},${property.longitude}`;
    return (
      <div className={styles["geocode-status"]}>
        📍 Geocoded ({property.latitude.toFixed(4)}, {property.longitude.toFixed(4)}){" "}
        <a href={mapUrl} target="_blank" rel="noreferrer" className={styles["geocode-link"]}>
          View on map ↗
        </a>
      </div>
    );
  }

  if (property.geocoded_at) {
    return (
      <div className={`${styles["geocode-status"]} ${styles["is-warn"]}`}>
        ⚠ Couldn&apos;t find this address automatically — or{" "}
        <Link href={`/properties?property=${property.id}`} className={styles["geocode-link"]}>
          set its location on the map
        </Link>
      </div>
    );
  }

  return (
    <div className={`${styles["geocode-status"]} ${styles["is-muted"]}`}>
      Not geocoded yet — save this deal, run the{" "}
      <Link href="/admin/geocode-backfill" className={styles["geocode-link"]}>
        geocode backfill
      </Link>
      , or{" "}
      <Link href={`/properties?property=${property.id}`} className={styles["geocode-link"]}>
        set its location on the map
      </Link>
    </div>
  );
}

function RelatedDeals({ deals, onSelectDeal }: { deals: Deal[]; onSelectDeal: (id: number) => void }) {
  if (deals.length === 0) return null;

  return (
    <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
      <label>Other deals at this property ({deals.length})</label>
      <div className={styles["related-deals"]}>
        {deals.map((d) => (
          <button key={d.id} type="button" className={styles["related-deal"]} onClick={() => onSelectDeal(d.id)}>
            <span className={styles["related-deal-name"]}>{d.deal_name}</span>
            <span className={styles["related-deal-stage"]}>{d.lost_at ? "Lost" : d.stage}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function DealModal({
  deal,
  relatedDeals,
  propertyOptions,
  onPropertyCreated,
  onSelectDeal,
  onClose,
  onSave,
  onDelete,
  onToggleLost,
  onUploadPhoto,
  onDeletePhoto,
  onUploadProposalPdf,
  onDeleteProposalPdf,
  onUploadAttachment,
  onDeleteAttachment,
}: DealModalProps) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [parsingAspire, setParsingAspire] = useState(false);
  const [aspireParseError, setAspireParseError] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null);
  const [attachmentPasteError, setAttachmentPasteError] = useState("");
  const attachmentPasteTargetRef = useRef<HTMLTextAreaElement>(null);
  // Whether ⌘V should be treated as an intentional "paste an attachment"
  // attempt right now — a ref, not state, since it's only ever read inside
  // event handlers and never drives a render.
  const attachmentPasteArmedRef = useRef(false);
  const [form, setForm] = useState({
    deal_name: deal.deal_name || "",
    company: deal.company || "",
    value: deal.value != null ? String(deal.value) : "",
    contact_first_name: deal.property?.contact?.first_name || "",
    contact_last_name: deal.property?.contact?.last_name || "",
    contact_email: deal.property?.contact?.email || "",
    contact_phone: deal.property?.contact?.phone || "",
    proposal_number: deal.proposal_number || "",
    proposal_date: deal.proposal_date || "",
    appointment_date: deal.appointment_date || "",
    property_id: deal.property_id,
    aspire_link: deal.aspire_link || "",
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

  const uploadAttachmentFile = useCallback(
    async (file: File) => {
      setUploadingAttachment(true);
      setAttachmentPasteError("");
      try {
        await onUploadAttachment(deal.id, file);
      } finally {
        setUploadingAttachment(false);
      }
    },
    [deal.id, onUploadAttachment]
  );

  function armAttachmentPasteTarget() {
    attachmentPasteArmedRef.current = true;
    attachmentPasteTargetRef.current?.focus();
  }

  async function handlePasteAttachmentClick() {
    setAttachmentPasteError("");
    if (!navigator.clipboard?.read) {
      setAttachmentPasteError("Press ⌘V / Ctrl+V now to paste");
      armAttachmentPasteTarget();
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      const typesSeen: string[] = [];
      for (const clipboardItem of clipboardItems) {
        typesSeen.push(...clipboardItem.types);
        const usableType = clipboardItem.types.find((type) => type.startsWith("image/") || type === "application/pdf");
        if (!usableType) continue;
        const blob = await clipboardItem.getType(usableType);
        const ext = usableType === "application/pdf" ? "pdf" : usableType.split("/")[1] || "png";
        files.push(new File([blob], `pasted-${Date.now()}.${ext}`, { type: usableType }));
      }
      if (files.length === 0) {
        // navigator.clipboard.read() only exposes a narrow, browser-defined
        // allowlist of MIME types — an image or PDF the OS clipboard holds
        // in a format outside that allowlist never shows up here at all.
        // Arming the hidden paste target and prompting a real ⌘V is the
        // reliable fallback: it triggers the browser's native paste event,
        // which isn't bound by that allowlist.
        setAttachmentPasteError(
          typesSeen.length > 0
            ? `Press ⌘V / Ctrl+V now to paste (clipboard.read() only saw: ${typesSeen.join(", ")})`
            : "Press ⌘V / Ctrl+V now to paste"
        );
        armAttachmentPasteTarget();
        return;
      }
      for (const file of files) await uploadAttachmentFile(file);
    } catch {
      setAttachmentPasteError("Press ⌘V / Ctrl+V now to paste");
      armAttachmentPasteTarget();
    }
  }

  // Listens for a real ⌘V anywhere in the modal, not just while the hidden
  // paste target has focus — an image or PDF on the clipboard is
  // unambiguously meant for the attachments list, so it's picked up
  // without requiring the Paste button first. A paste that turns out to
  // hold neither only surfaces an error when the user actually asked to
  // paste an attachment (armed); otherwise it's silently left alone, since
  // this modal has plenty of ordinary text fields a routine paste could
  // just as easily be headed for.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind !== "file") continue;
        if (!item.type.startsWith("image/") && item.type !== "application/pdf") continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length === 0) {
        if (!attachmentPasteArmedRef.current) return;
        const seen = Array.from(items).map((item) => `${item.kind}:${item.type || "(no type)"}`).join(", ");
        setAttachmentPasteError(`No image or PDF found in what was pasted (found: ${seen})`);
        return;
      }
      e.preventDefault();
      attachmentPasteArmedRef.current = false;
      setAttachmentPasteError("");
      files.forEach((file) => uploadAttachmentFile(file));
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [uploadAttachmentFile]);

  async function handleDeleteAttachmentClick(attachmentId: number) {
    setDeletingAttachmentId(attachmentId);
    try {
      await onDeleteAttachment(deal.id, attachmentId);
    } finally {
      setDeletingAttachmentId(null);
    }
  }

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleParseAspire() {
    const link = form.aspire_link.trim();
    if (!link) return;
    setParsingAspire(true);
    setAspireParseError("");
    try {
      const res = await fetchWithTimeout(
        "/api/sales-board/parse-aspire-proposal",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ link }),
        },
        PARSE_ASPIRE_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse proposal");

      // Only overwrite fields the parse actually found — this deal may
      // already have good data in fields the parse came up empty on, and a
      // partial miss shouldn't blank those out.
      setForm((f) => ({
        ...f,
        proposal_description: data.title ?? f.proposal_description,
        proposal_number: data.proposalNumber ?? f.proposal_number,
        proposal_date: data.proposalDate ?? f.proposal_date,
        value: data.value != null ? String(data.value) : f.value,
      }));

      const missing: string[] = [];
      if (!data.title) missing.push("title");
      if (!data.proposalNumber) missing.push("proposal #");
      if (!data.proposalDate) missing.push("date");
      if (data.value == null) missing.push("total");
      if (missing.length > 0) {
        setAspireParseError(`Couldn't find ${missing.join(", ")} in that PDF — check those fields`);
      }
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Timed out parsing that proposal — try again"
          : err instanceof Error
            ? err.message
            : "Failed to parse proposal";
      setAspireParseError(message);
    } finally {
      setParsingAspire(false);
    }
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
        property_id: form.property_id,
        aspire_link: form.aspire_link.trim() || null,
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

  async function handlePdfUpload(file: File) {
    setPdfBusy(true);
    try {
      await onUploadProposalPdf(deal.id, file);
    } finally {
      setPdfBusy(false);
    }
  }

  async function handlePdfDelete() {
    setPdfBusy(true);
    try {
      await onDeleteProposalPdf(deal.id);
    } finally {
      setPdfBusy(false);
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
            <input id="dm-email" type="text" inputMode="email" autoComplete="off" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
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
            <label htmlFor="dm-aspire-link">Aspire opportunity link</label>
            <div className={styles["aspire-link-row"]}>
              <input
                id="dm-aspire-link"
                type="url"
                autoComplete="off"
                placeholder="https://cloud.youraspire.com/..."
                value={form.aspire_link}
                onChange={(e) => set("aspire_link", e.target.value)}
              />
              <button
                type="button"
                className={styles["aspire-parse-btn"]}
                disabled={!form.aspire_link.trim() || parsingAspire}
                onClick={handleParseAspire}
              >
                {parsingAspire ? "Parsing…" : "Parse from Aspire"}
              </button>
            </div>
            {aspireParseError && <div className={styles["card-edit-error"]}>{aspireParseError}</div>}
          </div>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label>Proposal PDF</label>
            <div className={styles["proposal-pdf"]}>
              {deal.proposal_pdf_path && (
                <a
                  href={dealDocumentUrl(deal.proposal_pdf_path)}
                  target="_blank"
                  rel="noreferrer"
                  className={styles["proposal-pdf-link"]}
                >
                  📄 View proposal
                </a>
              )}
              {pdfBusy ? (
                <span className={styles["proposal-pdf-busy"]}>Working…</span>
              ) : (
                <>
                  <label className={styles["proposal-pdf-add"]}>
                    {deal.proposal_pdf_path ? "Replace" : "+ Upload PDF"}
                    <input
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handlePdfUpload(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {deal.proposal_pdf_path && (
                    <button type="button" className={styles["proposal-pdf-remove"]} onClick={handlePdfDelete}>
                      Remove
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label>Attachments (POs, receipts)</label>
            {deal.attachments.length > 0 && (
              <div className={styles["attachments-list"]}>
                {deal.attachments.map((attachment) => (
                  <div key={attachment.id} className={styles["attachment-row"]}>
                    <a
                      href={dealAttachmentUrl(attachment.storage_path)}
                      target="_blank"
                      rel="noreferrer"
                      className={styles["attachment-link"]}
                    >
                      <span className={styles["attachment-icon"]}>{attachment.kind === "pdf" ? "📄" : "🖼️"}</span>
                      <span className={styles["attachment-name"]}>{attachment.file_name}</span>
                      <span className={styles["attachment-date"]}>{formatDateTime(attachment.created_at)}</span>
                    </a>
                    <button
                      type="button"
                      className={styles["attachment-remove"]}
                      aria-label="Delete attachment"
                      disabled={deletingAttachmentId === attachment.id}
                      onClick={() => handleDeleteAttachmentClick(attachment.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={styles["attachment-actions"]}>
              <label className={styles["attachment-add"]}>
                + Add file
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files) Array.from(files).forEach((file) => uploadAttachmentFile(file));
                    e.target.value = "";
                  }}
                />
              </label>
              <button type="button" className={styles["attachment-paste-btn"]} onClick={handlePasteAttachmentClick}>
                📋 Paste from clipboard
              </button>
              {uploadingAttachment && <span className={styles["proposal-pdf-busy"]}>Uploading…</span>}
            </div>
            {attachmentPasteError && <div className={styles["card-edit-error"]}>{attachmentPasteError}</div>}
            <textarea
              ref={attachmentPasteTargetRef}
              className={styles["paste-target"]}
              aria-hidden="true"
              tabIndex={-1}
              value=""
              onChange={() => {}}
            />
          </div>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-jobsite">Jobsite address</label>
            <PropertyPicker
              id="dm-jobsite"
              propertyOptions={propertyOptions}
              value={form.property_id}
              onChange={(propertyId) => setForm((f) => ({ ...f, property_id: propertyId }))}
              onCreated={onPropertyCreated}
            />
            <GeocodeStatus deal={deal} />
          </div>
          <RelatedDeals deals={relatedDeals} onSelectDeal={onSelectDeal} />
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-next-action">Next action</label>
            <input id="dm-next-action" autoComplete="off" value={form.next_action} onChange={(e) => set("next_action", e.target.value)} />
          </div>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-description">Proposal description</label>
            <textarea id="dm-description" rows={3} value={form.proposal_description} onChange={(e) => set("proposal_description", e.target.value)} />
          </div>

          <div className={styles["photo-events"]}>
            {deal.events
              .filter((event) => event.photos.length > 0)
              .map((event) => (
                <div key={event.id} className={styles["photo-event-group"]}>
                  <div className={styles["photo-event-header"]}>
                    {event.event_type && <span className={styles["event-type-badge"]}>{event.event_type}</span>}
                    <span className={styles["photo-event-name"]}>{event.name ?? "Site visit"}</span>
                    <span className={styles["photo-event-date"]}>{formatDateTime(event.start_time)}</span>
                    <Link href={`/calendar?event=${event.id}`} className={styles["photo-event-link"]}>
                      View on Calendar →
                    </Link>
                  </div>
                  <div className={styles["photo-row"]}>
                    {event.photos.map((photo) => {
                      const thumbUrl = dealThumbUrl(photo);
                      return (
                        <div key={photo.id} className={styles["photo-thumb"]}>
                          {thumbUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumbUrl} alt={photo.caption ?? deal.deal_name} />
                          ) : (
                            <span className={styles["photo-thumb-placeholder"]}>🎬</span>
                          )}
                          {photo.media_type === "video" && <span className={styles["video-badge"]}>▶</span>}
                          {photo.is_outlier && (
                            <span className={styles["outlier-badge"]} title="Dated differently than the rest of this event">
                              ⚠
                            </span>
                          )}
                          <button
                            type="button"
                            className={styles["photo-remove"]}
                            aria-label="Delete photo"
                            onClick={() => onDeletePhoto(deal.id, photo.id)}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
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
