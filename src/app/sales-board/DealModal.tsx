"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./sales-board.module.css";
import PropertyPicker from "./PropertyPicker";
import TextTemplateMenu from "./TextTemplateMenu";
import {
  dealAttachmentUrl,
  dealCorrespondenceUrl,
  dealDocumentUrl,
  dealThumbUrl,
  type Deal,
  type DealCorrespondence,
  type DealInput,
  type DealPhoto,
  type DealTranscript,
  type Email,
  type PropertyOption,
} from "@/lib/salesBoard";
import { TASK_CONTEXTS, type TaskContext } from "@/lib/tasks";
import { fetchWithTimeout } from "@/lib/withTimeout";
import { MILESTONES, formatMilestoneDate } from "@/app/next-actions/DealTimeline";

const PARSE_ASPIRE_TIMEOUT_MS = 25000;
// Driving Aspire's search headlessly is slow by nature — page load, a
// debounced result list, a click, then the proposal page's own load — and the
// budget also covers the verification-code pause, where the run waits up to
// two minutes for a code to be typed into the live view.
const FIND_ASPIRE_TIMEOUT_MS = 300000;
const ADD_TASK_TIMEOUT_MS = 15000;

// Display for a logged call/email/text touchpoint in the Correspondence list.
const CHANNEL_META: Record<"call" | "email" | "text", { icon: string; label: string }> = {
  call: { icon: "📞", label: "Called" },
  email: { icon: "✉️", label: "Emailed" },
  text: { icon: "💬", label: "Texted" },
};

// One row of Aspire's search dropdown, as returned by /api/aspire-search when
// a proposal number matched more than one result.
interface AspireCandidate {
  index: number;
  title: string;
  subtitle: string;
}

const EMPTY_INLINE_TASK_FORM = { title: "", context: "" as TaskContext | "", start_date: "", duration_hours: "", is_next_action: false };

interface DealModalProps {
  deal: Deal;
  relatedDeals: Deal[];
  propertyOptions: PropertyOption[];
  onPropertyCreated: (option: PropertyOption) => void;
  onTaskAdded: () => void;
  onSelectDeal: (id: number) => void;
  onClose: () => void;
  onSave: (id: number, updates: Partial<DealInput>) => Promise<void>;
  onDelete: (deal: Deal) => void;
  onToggleLost: (deal: Deal) => Promise<void>;
  onToggleFlag: (deal: Deal) => Promise<void>;
  onUploadPhoto: (dealId: number, file: File) => Promise<void>;
  onUploadReferencePhoto: (propertyId: number, file: File) => Promise<void>;
  onDeletePhoto: (dealId: number, photoId: number) => Promise<void>;
  onUploadProposalPdf: (dealId: number, file: File) => Promise<void>;
  onDeleteProposalPdf: (dealId: number) => Promise<void>;
  onUploadAttachment: (dealId: number, file: File) => Promise<void>;
  onDeleteAttachment: (dealId: number, attachmentId: number) => Promise<void>;
  onUploadCorrespondence: (dealId: number, file: File, parentId?: number) => Promise<void>;
  onLogCorrespondence: (dealId: number, channel: "call" | "email" | "text") => Promise<void>;
  // Called once a proposal's Aspire URL is resolved, so the board's copy of the
  // deal picks up the link the search route just cached on the row.
  onAspireLinkResolved: (dealId: number, url: string) => void;
  onDeleteCorrespondence: (dealId: number, correspondenceId: number) => Promise<void>;
  onAddTranscript: (
    dealId: number,
    input: { transcript: string; title?: string | null; recorded_at?: string | null }
  ) => Promise<void>;
  onEditTranscript: (
    dealId: number,
    transcriptId: number,
    updates: { transcript?: string; title?: string | null; recorded_at?: string | null }
  ) => Promise<void>;
  onDeleteTranscript: (dealId: number, transcriptId: number) => Promise<void>;
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

// Adding a task here always ties it to this deal — unlike the Tasks page's
// own add form, there's no deal picker, since being opened from a specific
// deal's modal already answers that question.
function AddTaskInline({ dealId, currentNextAction, onAdded }: { dealId: number; currentNextAction: string | null; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_INLINE_TASK_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function openForm() {
    setForm(EMPTY_INLINE_TASK_FORM);
    setError("");
    setOpen(true);
  }

  function closeForm() {
    setOpen(false);
    setForm(EMPTY_INLINE_TASK_FORM);
    setError("");
  }

  async function handleSubmit() {
    const title = form.title.trim();
    if (!title || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetchWithTimeout(
        "/api/tasks",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            deal_id: dealId,
            context: form.context || null,
            start_date: form.start_date || null,
            duration_hours: form.duration_hours.trim() ? Number(form.duration_hours) : null,
            is_next_action: form.is_next_action,
          }),
        },
        ADD_TASK_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add task");
      // Lets the Tasks page pick this up live if it's open elsewhere, and
      // refreshes this board so deal.next_action reflects it immediately
      // if it was marked as the next action.
      window.dispatchEvent(new Event("tasks:changed"));
      onAdded();
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add task");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles["geocode-link"]} onClick={openForm}>
        + Add task
      </button>
    );
  }

  return (
    // A <div>, not a <form> — this renders inside the deal-edit <form> already,
    // and nesting forms is invalid HTML (and breaks child <select>/<input>
    // rendering). Enter submits manually instead of via native form submit.
    <div
      className={styles["inline-task-form"]}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
          e.preventDefault();
          handleSubmit();
        }
      }}
    >
      <input
        autoFocus
        autoComplete="off"
        placeholder="Task title"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
      />
      <div className={styles["inline-task-form-row"]}>
        <select value={form.context} onChange={(e) => setForm((f) => ({ ...f, context: e.target.value as TaskContext | "" }))}>
          <option value="">No context</option>
          {TASK_CONTEXTS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
        <input
          type="number"
          min="0"
          step="0.5"
          placeholder="Hours"
          value={form.duration_hours}
          onChange={(e) => setForm((f) => ({ ...f, duration_hours: e.target.value }))}
        />
      </div>
      <label className={styles["inline-task-next-action"]}>
        <input
          type="checkbox"
          checked={form.is_next_action}
          onChange={(e) => setForm((f) => ({ ...f, is_next_action: e.target.checked }))}
        />
        Mark as this deal&apos;s next action
      </label>
      {form.is_next_action && currentNextAction && (
        <div className={styles["inline-task-hint"]}>This will replace &quot;{currentNextAction}&quot; as the next action.</div>
      )}
      {error && <div className={styles["inline-task-error"]}>{error}</div>}
      <div className={styles["inline-task-form-actions"]}>
        <button type="button" className={styles["card-edit-cancel"]} onClick={closeForm} disabled={submitting}>
          Cancel
        </button>
        <button type="button" className={styles["card-edit-save"]} onClick={handleSubmit} disabled={submitting || !form.title.trim()}>
          {submitting ? "Adding…" : "Add Task"}
        </button>
      </div>
    </div>
  );
}

// A plain date ("YYYY-MM-DD") from an ISO/date string, for prefilling the date
// input. Empty when there's no value.
function toDateInput(value: string | null): string {
  if (!value) return "";
  // Accept both "YYYY-MM-DD" and full ISO — take the leading date part.
  return value.slice(0, 10);
}

// The deal's appointment transcripts: a list of collapsible entries plus an
// add/edit form. Managed as its own component so its draft state doesn't bloat
// the modal, and so the editor can be reused for both add and edit.
function TranscriptsSection({
  deal,
  onAdd,
  onEdit,
  onDelete,
}: {
  deal: Deal;
  onAdd: (
    dealId: number,
    input: { transcript: string; title?: string | null; recorded_at?: string | null }
  ) => Promise<void>;
  onEdit: (
    dealId: number,
    transcriptId: number,
    updates: { transcript?: string; title?: string | null; recorded_at?: string | null }
  ) => Promise<void>;
  onDelete: (dealId: number, transcriptId: number) => Promise<void>;
}) {
  // null = closed; "new" = add form; a number = editing that transcript.
  const [editing, setEditing] = useState<"new" | number | null>(null);
  const [title, setTitle] = useState("");
  const [recordedAt, setRecordedAt] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  function openNew() {
    setEditing("new");
    setTitle("");
    setRecordedAt("");
    setText("");
  }

  function openEdit(t: DealTranscript) {
    setEditing(t.id);
    setTitle(t.title ?? "");
    setRecordedAt(toDateInput(t.recorded_at));
    setText(t.transcript);
  }

  function close() {
    setEditing(null);
    setTitle("");
    setRecordedAt("");
    setText("");
  }

  async function save() {
    const body = text.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      const fields = {
        transcript: body,
        title: title.trim() || null,
        recorded_at: recordedAt || null,
      };
      if (editing === "new") await onAdd(deal.id, fields);
      else if (typeof editing === "number") await onEdit(deal.id, editing, fields);
      close();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles["deal-section"]}>
      <h3 className={styles["deal-section-title"]}>Transcripts</h3>
      <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
        {deal.transcripts.length === 0 && editing !== "new" ? (
          <p className={styles["deal-emails-empty"]}>
            No appointment transcripts yet. Add one to keep the conversation on record with this deal.
          </p>
        ) : (
          <div className={styles["deal-transcripts-list"]}>
            {deal.transcripts.map((t) =>
              editing === t.id ? (
                <TranscriptEditor
                  key={t.id}
                  title={title}
                  recordedAt={recordedAt}
                  text={text}
                  saving={saving}
                  onTitle={setTitle}
                  onRecordedAt={setRecordedAt}
                  onText={setText}
                  onSave={save}
                  onCancel={close}
                />
              ) : (
                <details key={t.id} className={styles["deal-transcript"]}>
                  <summary className={styles["deal-transcript-head"]}>
                    <span className={styles["deal-email-icon"]}>📝</span>
                    <span className={styles["deal-transcript-meta"]}>
                      <span className={styles["deal-transcript-title"]}>{t.title || "Appointment transcript"}</span>
                      <span className={styles["deal-transcript-sub"]}>
                        {t.recorded_at
                          ? formatMilestoneDate(toDateInput(t.recorded_at))
                          : `Saved ${formatDateTime(t.created_at)}`}
                      </span>
                    </span>
                  </summary>
                  <pre className={styles["deal-transcript-body"]}>{t.transcript}</pre>
                  <div className={styles["deal-transcript-actions"]}>
                    <button type="button" onClick={() => openEdit(t)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles["deal-transcript-delete"]}
                      onClick={() => {
                        if (confirm("Delete this transcript?")) onDelete(deal.id, t.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </details>
              )
            )}
          </div>
        )}

        {editing === "new" ? (
          <TranscriptEditor
            title={title}
            recordedAt={recordedAt}
            text={text}
            saving={saving}
            onTitle={setTitle}
            onRecordedAt={setRecordedAt}
            onText={setText}
            onSave={save}
            onCancel={close}
          />
        ) : (
          editing === null && (
            <button type="button" className={styles["deal-transcript-add-btn"]} onClick={openNew}>
              + Add transcript
            </button>
          )
        )}
      </div>
    </section>
  );
}

function TranscriptEditor({
  title,
  recordedAt,
  text,
  saving,
  onTitle,
  onRecordedAt,
  onText,
  onSave,
  onCancel,
}: {
  title: string;
  recordedAt: string;
  text: string;
  saving: boolean;
  onTitle: (v: string) => void;
  onRecordedAt: (v: string) => void;
  onText: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles["deal-transcript-form"]}>
      <div className={styles["deal-transcript-form-row"]}>
        <input
          type="text"
          placeholder="Title (optional) — e.g. Kitchen walkthrough"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
        />
        <input
          type="date"
          value={recordedAt}
          onChange={(e) => onRecordedAt(e.target.value)}
          title="Appointment date"
        />
      </div>
      <textarea
        autoFocus
        placeholder="Paste or type the appointment transcript…"
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
      <div className={styles["deal-transcript-form-actions"]}>
        <button type="button" className={styles["deal-transcript-save"]} onClick={onSave} disabled={saving || !text.trim()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className={styles["deal-transcript-cancel"]} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function DealModal({
  deal,
  relatedDeals,
  propertyOptions,
  onPropertyCreated,
  onTaskAdded,
  onSelectDeal,
  onClose,
  onSave,
  onDelete,
  onToggleLost,
  onToggleFlag,
  onUploadPhoto,
  onUploadReferencePhoto,
  onDeletePhoto,
  onUploadProposalPdf,
  onDeleteProposalPdf,
  onUploadAttachment,
  onDeleteAttachment,
  onUploadCorrespondence,
  onLogCorrespondence,
  onAspireLinkResolved,
  onDeleteCorrespondence,
  onAddTranscript,
  onEditTranscript,
  onDeleteTranscript,
}: DealModalProps) {
  const router = useRouter();
  // The deal's single estimate: undefined = loading, null = none yet.
  const [estimateInfo, setEstimateInfo] = useState<{ id: string; total: number | null } | null | undefined>(undefined);
  const [creatingEstimate, setCreatingEstimate] = useState(false);
  // The deal's designs: undefined = loading.
  const [designs, setDesigns] = useState<{ id: string; name: string }[] | undefined>(undefined);
  const [creatingDesign, setCreatingDesign] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [parsingAspire, setParsingAspire] = useState(false);
  const [aspireParseError, setAspireParseError] = useState("");
  // "Find in Aspire" (next to the proposal number): resolves the proposal's
  // Aspire URL through the headless-search route, then opens it.
  const [findingAspire, setFindingAspire] = useState(false);
  const [aspireFindError, setAspireFindError] = useState("");
  // Populated only when a proposal number matched more than one Aspire result,
  // so the search can't pick for us — the user clicks the right one.
  const [aspireCandidates, setAspireCandidates] = useState<AspireCandidate[]>([]);
  // While a search runs, the backend parks a Browserless live-view URL — a
  // page where the user can watch (and type into) the robot's browser. Polled
  // here so the "Watch live" link appears as soon as the run has one.
  const [aspireLiveView, setAspireLiveView] = useState<{ url: string; note: string | null } | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null);
  const [attachmentPasteError, setAttachmentPasteError] = useState("");
  const attachmentPasteTargetRef = useRef<HTMLTextAreaElement>(null);
  // Whether ⌘V should be treated as an intentional "paste an attachment"
  // attempt right now — a ref, not state, since it's only ever read inside
  // event handlers and never drives a render.
  const attachmentPasteArmedRef = useRef(false);
  const [uploadingCorrespondence, setUploadingCorrespondence] = useState(false);
  const [deletingCorrespondenceId, setDeletingCorrespondenceId] = useState<number | null>(null);
  const [correspondencePasteError, setCorrespondencePasteError] = useState("");
  const correspondencePasteTargetRef = useRef<HTMLTextAreaElement>(null);
  // Both attachments and correspondence only ever claim a ⌘V when explicitly
  // armed (their own Paste button was clicked, or their hidden target is
  // focused). Photos are the ambient default target — an untargeted image
  // paste anywhere in the modal becomes a photo (see the shared paste
  // listener below), so a document-level listener can't otherwise tell which
  // section an untargeted ⌘V was meant for without risking a double-upload.
  const correspondencePasteArmedRef = useRef(false);
  // Which logged correspondence entry a pasted screenshot attaches to (set when
  // an entry's Paste button is pressed).
  const correspondencePasteParentRef = useRef<number | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoPasteError, setPhotoPasteError] = useState("");
  // The deal's property's general-reference photos (where pasted images go).
  // Fetched client-side, not embedded in the deal, since deal_photos is a
  // junction table and cross-table embeds risk PostgREST ambiguity.
  const [referencePhotos, setReferencePhotos] = useState<DealPhoto[]>([]);
  // Every photo across the whole PROPERTY (all its deals + reference photos),
  // oldest-first — the source for the photo strip above the timeline, which
  // spans the property's full history, not just this deal.
  const [stripPhotos, setStripPhotos] = useState<DealPhoto[]>([]);
  // The property's correspondence (across all its deals) — interleaved into the
  // strip as icon tiles alongside the photos.
  const [stripCorrespondence, setStripCorrespondence] = useState<DealCorrespondence[]>([]);
  // The property's forwarded-in emails (matched by contact), oldest-first —
  // shown in the deal modal's Emails list and as 📧 tiles/dots on the strip.
  const [stripEmails, setStripEmails] = useState<Email[]>([]);
  // The property's album cover photo (properties.cover_photo_id), shown as a
  // thumbnail in the modal header. Fetched by id, like the reference photos.
  const [coverPhoto, setCoverPhoto] = useState<DealPhoto | null>(null);
  // Hidden target the ambient ⌘V focuses so a native paste event fires (a
  // document-level paste only dispatches when something editable is focused).
  const photoPasteTargetRef = useRef<HTMLTextAreaElement>(null);
  // Wraps the form fields; the lock toggle flips readOnly on every text
  // input/textarea inside (buttons and uploads are left alone), so locking is
  // purely about the data fields — see the effect below.
  const fieldsRef = useRef<HTMLDivElement>(null);
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
    rfp_date: deal.rfp_date || "",
    won_date: deal.won_date || "",
    invoiced_date: deal.invoiced_date || "",
    paid_date: deal.paid_date || "",
    appointment_date: deal.appointment_date || "",
    start_date: deal.start_date || "",
    end_date: deal.end_date || "",
    property_id: deal.property_id,
    aspire_link: deal.aspire_link || "", // "Proposal link"
    opportunity_link: deal.opportunity_link || "", // "Aspire opportunity link"
    proposal_description: deal.proposal_description || "",
  });
  const [saving, setSaving] = useState(false);
  const [lostBusy, setLostBusy] = useState(false);
  const [flagBusy, setFlagBusy] = useState(false);
  const [error, setError] = useState("");
  // The modal opens read-only; the fields (and Save) unlock via the header
  // lock toggle, so a deal can't be edited by accident just from viewing it.
  const [locked, setLocked] = useState(true);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Poll for the run's live-view link only while a search is actually running;
  // the backend clears the value when the run ends.
  useEffect(() => {
    if (!findingAspire) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/aspire-live");
        const data = await res.json();
        if (active) setAspireLiveView(data.live ?? null);
      } catch {
        // A missed poll just delays the link a beat.
      }
    };
    void poll();
    const id = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(id);
      // The run is over (or was abandoned) — drop the link with it. Cleanup
      // runs outside the render pass, so this doesn't cascade.
      setAspireLiveView(null);
    };
  }, [findingAspire]);

  // Load this deal's estimate (if any) to show Open-vs-Create.
  useEffect(() => {
    let active = true;
    setEstimateInfo(undefined);
    fetch(`/api/sales-board/${deal.id}/estimate`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((data) => { if (active) setEstimateInfo(data.estimate ?? null); })
      .catch(() => { if (active) setEstimateInfo(null); });
    return () => { active = false; };
  }, [deal.id]);

  const handleCreateEstimate = useCallback(async () => {
    setCreatingEstimate(true);
    try {
      const res = await fetch(`/api/sales-board/${deal.id}/estimate`, { method: "POST" });
      if (!res.ok) throw new Error("create failed");
      const { id } = await res.json();
      router.push(`/estimator/${id}`);
    } catch {
      setError("Could not create an estimate for this deal.");
      setCreatingEstimate(false);
    }
  }, [deal.id, router]);

  // Load this deal's designs (perspective renderings).
  useEffect(() => {
    let active = true;
    setDesigns(undefined);
    fetch(`/api/sales-board/${deal.id}/design`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((data) => { if (active) setDesigns(data.designs ?? []); })
      .catch(() => { if (active) setDesigns([]); });
    return () => { active = false; };
  }, [deal.id]);

  const handleCreateDesign = useCallback(async () => {
    setCreatingDesign(true);
    try {
      const res = await fetch(`/api/sales-board/${deal.id}/design`, { method: "POST" });
      if (!res.ok) throw new Error("create failed");
      const { id } = await res.json();
      router.push(`/design/${id}`);
    } catch {
      setError("Could not create a design for this deal.");
      setCreatingDesign(false);
    }
  }, [deal.id, router]);

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

  const uploadCorrespondenceFile = useCallback(
    async (file: File, parentId?: number) => {
      setUploadingCorrespondence(true);
      setCorrespondencePasteError("");
      try {
        await onUploadCorrespondence(deal.id, file, parentId);
      } finally {
        setUploadingCorrespondence(false);
      }
    },
    [deal.id, onUploadCorrespondence]
  );

  const uploadPhotoFile = useCallback(
    async (file: File) => {
      setUploadingPhoto(true);
      try {
        await onUploadPhoto(deal.id, file);
      } finally {
        setUploadingPhoto(false);
      }
    },
    [deal.id, onUploadPhoto]
  );

  const loadReferencePhotos = useCallback(async () => {
    const propertyId = deal.property_id;
    if (propertyId == null) return;
    try {
      const res = await fetch(`/api/properties/${propertyId}/photos`);
      if (!res.ok) return;
      const data = await res.json();
      setReferencePhotos(data.photos ?? []);
    } catch {
      /* leave the current list as-is on a transient fetch error */
    }
  }, [deal.property_id]);

  // Pasted images are filed under the deal's property as general-reference
  // photos (no calendar event created), unlike the "+ Photo" button which
  // adds jobsite/event photos. Re-fetch after upload so the new photo shows
  // up in the modal's reference section right away.
  const uploadReferencePhotoFile = useCallback(
    async (file: File) => {
      const propertyId = deal.property_id;
      if (propertyId == null) {
        setPhotoPasteError("This deal has no linked property to attach reference photos to.");
        return;
      }
      setUploadingPhoto(true);
      setPhotoPasteError("");
      try {
        await onUploadReferencePhoto(propertyId, file);
        await loadReferencePhotos();
      } finally {
        setUploadingPhoto(false);
      }
    },
    [deal.property_id, onUploadReferencePhoto, loadReferencePhotos]
  );

  useEffect(() => {
    const propertyId = deal.property_id;
    if (propertyId == null) return;
    let active = true;
    fetch(`/api/properties/${propertyId}/photos`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((data) => {
        if (active) setReferencePhotos(data.photos ?? []);
      })
      .catch(() => {
        /* leave the current list as-is on a transient fetch error */
      });
    return () => {
      active = false;
    };
  }, [deal.property_id]);

  // Load every photo at the property (across all its deals) for the strip.
  useEffect(() => {
    const propertyId = deal.property_id;
    if (propertyId == null) {
      setStripPhotos([]);
      setStripCorrespondence([]);
      setStripEmails([]);
      return;
    }
    let active = true;
    fetch(`/api/properties/${propertyId}/all-photos`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((data) => {
        if (!active) return;
        setStripPhotos(data.photos ?? []);
        setStripCorrespondence(data.correspondence ?? []);
        setStripEmails(data.emails ?? []);
      })
      .catch(() => {
        /* leave the current list as-is on a transient fetch error */
      });
    return () => {
      active = false;
    };
  }, [deal.property_id]);

  useEffect(() => {
    const propertyId = deal.property_id;
    if (propertyId == null) return;
    let active = true;
    fetch(`/api/properties/${propertyId}/cover`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((data) => {
        if (active) setCoverPhoto(data.photo ?? null);
      })
      .catch(() => {
        /* no cover shown on a transient fetch error */
      });
    return () => {
      active = false;
    };
  }, [deal.property_id]);

  // Lock/unlock is purely a field concern: flip readOnly on every text input
  // and textarea inside the form (skipping file inputs and the hidden paste
  // catchers). Buttons, uploads, and links are never touched, so they keep
  // working whether locked or not. readOnly (not disabled) keeps values fully
  // legible and selectable; the .is-locked styling drops the edit-box chrome.
  useEffect(() => {
    const root = fieldsRef.current;
    if (!root) return;
    root.querySelectorAll("input, textarea").forEach((el) => {
      const node = el as HTMLInputElement | HTMLTextAreaElement;
      if (node instanceof HTMLInputElement && node.type === "file") return;
      if (node.getAttribute("aria-hidden") === "true") return;
      if (node.readOnly !== locked) node.readOnly = locked;
    });
  });

  async function handleDeleteReferencePhoto(photoId: number) {
    const propertyId = deal.property_id;
    if (propertyId == null) return;
    try {
      const res = await fetch(`/api/properties/${propertyId}/photos/${photoId}`, { method: "DELETE" });
      if (res.ok) setReferencePhotos((ps) => ps.filter((p) => p.id !== photoId));
    } catch {
      /* ignore — the photo simply stays until the next reload */
    }
  }

  // Focus the hidden photo catcher (without scrolling to it, so no flicker)
  // so that a native paste event fires and is handled by the shared paste
  // listener's ambient photo branch — which reads the image via
  // getAsFile(), a plain uploadable File. This is the reliable path: the
  // async Clipboard API (clipboard.read/getType) is inconsistent across
  // browsers and hands back blobs that don't always serialize for upload.
  function armPhotoPasteTarget() {
    photoPasteTargetRef.current?.focus({ preventScroll: true });
  }

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

  function armCorrespondencePasteTarget() {
    correspondencePasteArmedRef.current = true;
    correspondencePasteTargetRef.current?.focus();
  }

  async function handlePasteCorrespondenceClick(parentId: number) {
    correspondencePasteParentRef.current = parentId;
    setCorrespondencePasteError("");
    if (!navigator.clipboard?.read) {
      setCorrespondencePasteError("Press ⌘V / Ctrl+V now to paste");
      armCorrespondencePasteTarget();
      return;
    }
    try {
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      const typesSeen: string[] = [];
      for (const clipboardItem of clipboardItems) {
        typesSeen.push(...clipboardItem.types);
        const usableType = clipboardItem.types.find((type) => type.startsWith("image/"));
        if (!usableType) continue;
        const blob = await clipboardItem.getType(usableType);
        const ext = usableType.split("/")[1] || "png";
        files.push(new File([blob], `pasted-${Date.now()}.${ext}`, { type: usableType }));
      }
      if (files.length === 0) {
        setCorrespondencePasteError(
          typesSeen.length > 0
            ? `Press ⌘V / Ctrl+V now to paste (clipboard.read() only saw: ${typesSeen.join(", ")})`
            : "Press ⌘V / Ctrl+V now to paste"
        );
        armCorrespondencePasteTarget();
        return;
      }
      for (const file of files) await uploadCorrespondenceFile(file, correspondencePasteParentRef.current ?? undefined);
    } catch {
      setCorrespondencePasteError("Press ⌘V / Ctrl+V now to paste");
      armCorrespondencePasteTarget();
    }
  }

  // A single shared listener for all three sections — independent listeners
  // would each try to claim the same raw ⌘V, double-uploading one pasted
  // image. Priority: an explicitly armed section wins (correspondence or
  // attachments, each armed by its own Paste button / focused hidden
  // target); otherwise an untargeted image paste falls through to photos,
  // the ambient default target. Text pastes into inputs are never touched —
  // the photo branch only claims file-kind image items and returns quietly
  // (no preventDefault) when the clipboard holds no image.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      if (correspondencePasteArmedRef.current) {
        const files: File[] = [];
        for (const item of Array.from(items)) {
          if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
          const file = item.getAsFile();
          if (file) files.push(file);
        }
        if (files.length === 0) {
          const seen = Array.from(items).map((item) => `${item.kind}:${item.type || "(no type)"}`).join(", ");
          setCorrespondencePasteError(`No image found in what was pasted (found: ${seen})`);
          return;
        }
        e.preventDefault();
        correspondencePasteArmedRef.current = false;
        setCorrespondencePasteError("");
        const parentId = correspondencePasteParentRef.current ?? undefined;
        files.forEach((file) => uploadCorrespondenceFile(file, parentId));
        return;
      }

      if (attachmentPasteArmedRef.current) {
        const files: File[] = [];
        for (const item of Array.from(items)) {
          if (item.kind !== "file") continue;
          if (!item.type.startsWith("image/") && item.type !== "application/pdf") continue;
          const file = item.getAsFile();
          if (file) files.push(file);
        }
        if (files.length === 0) {
          const seen = Array.from(items).map((item) => `${item.kind}:${item.type || "(no type)"}`).join(", ");
          setAttachmentPasteError(`No image or PDF found in what was pasted (found: ${seen})`);
          return;
        }
        e.preventDefault();
        attachmentPasteArmedRef.current = false;
        setAttachmentPasteError("");
        files.forEach((file) => uploadAttachmentFile(file));
        return;
      }

      // Ambient default: an untargeted image paste becomes a photo. When the
      // ⌘V handler armed the hidden catcher, release its focus now that the
      // paste has landed (so focus doesn't linger in an invisible field).
      const usedCatcher = document.activeElement === photoPasteTargetRef.current;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (usedCatcher) photoPasteTargetRef.current?.blur();
      if (files.length === 0) return;
      e.preventDefault();
      setPhotoPasteError("");
      files.forEach((file) => uploadReferencePhotoFile(file));
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [uploadAttachmentFile, uploadCorrespondenceFile, uploadReferencePhotoFile]);

  // A bare ⌘V / Ctrl+V only dispatches a `paste` event when an editable
  // element is focused, so with nothing focused the ambient photo target
  // would never fire. Intercept the keystroke and focus the hidden catcher
  // (without scrolling, so no flicker) a beat before the browser performs
  // the paste — that same ⌘V then lands a native paste event the shared
  // listener handles. Skipped while the user is typing in a field or a
  // section is armed (its own hidden target handles the paste).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== "v" && e.key !== "V")) return;
      if (correspondencePasteArmedRef.current || attachmentPasteArmedRef.current) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active?.isContentEditable) return;
      setPhotoPasteError("");
      armPhotoPasteTarget();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  async function handleDeleteAttachmentClick(attachmentId: number) {
    setDeletingAttachmentId(attachmentId);
    try {
      await onDeleteAttachment(deal.id, attachmentId);
    } finally {
      setDeletingAttachmentId(null);
    }
  }

  async function handleDeleteCorrespondenceClick(correspondenceId: number) {
    setDeletingCorrespondenceId(correspondenceId);
    try {
      await onDeleteCorrespondence(deal.id, correspondenceId);
    } finally {
      setDeletingCorrespondenceId(null);
    }
  }

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // A single Key-dates cell: stage tag, label, the date input, and a ✕ that
  // clears just that date (after a confirm) when it holds a value.
  function renderKeyDate(
    tag: string,
    label: string,
    id: string,
    field:
      | "rfp_date"
      | "appointment_date"
      | "proposal_date"
      | "won_date"
      | "start_date"
      | "end_date"
      | "invoiced_date"
      | "paid_date",
    min?: string
  ) {
    const value = form[field];
    return (
      <div className={styles["date-stage-cell"]}>
        <span className={styles["date-stage-tag"]}>{tag}</span>
        <label htmlFor={id}>{label}</label>
        <div className={styles["date-input-row"]}>
          <input id={id} type="date" value={value} min={min} onChange={(e) => set(field, e.target.value)} />
          {value && (
            <button
              type="button"
              className={styles["date-clear-btn"]}
              title={`Clear ${label}`}
              aria-label={`Clear ${label}`}
              onClick={() => {
                if (window.confirm(`Are you sure you want to reset the ${label.toLowerCase()}?`)) set(field, "");
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  // Opens the deal's Aspire proposal page. Aspire has no URL pattern to jump
  // to — the only way in is typing the number into its search box and clicking
  // the result — so the first click runs that path server-side in a headless
  // browser (/api/aspire-search), which caches the URL it lands on onto the
  // deal. Every click after that is just an open.
  async function handleFindInAspire({ resultIndex, refresh }: { resultIndex?: number; refresh?: boolean } = {}) {
    const known = form.aspire_link.trim();
    if (known && !refresh && resultIndex === undefined) {
      window.open(known, "_blank", "noopener,noreferrer");
      return;
    }

    const proposalNumber = form.proposal_number.trim();
    if (!proposalNumber) return;

    // Safari blocks window.open() once an await has intervened, so the tab is
    // claimed up front and pointed at the URL when it arrives.
    const tab = window.open("", "_blank");
    setFindingAspire(true);
    setAspireFindError("");
    if (resultIndex !== undefined) setAspireCandidates([]);
    try {
      const res = await fetchWithTimeout(
        "/api/aspire-search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId: deal.id, proposalNumber, resultIndex, refresh }),
        },
        FIND_ASPIRE_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.candidates) && data.candidates.length > 0) {
          setAspireCandidates(data.candidates as AspireCandidate[]);
        }
        throw new Error(data.error || "Couldn't find that proposal in Aspire");
      }

      setForm((f) => ({ ...f, aspire_link: data.url }));
      onAspireLinkResolved(deal.id, data.url);
      setAspireCandidates([]);
      if (data.saveError) {
        setAspireFindError(`Opened it, but couldn't save the link for next time: ${data.saveError}`);
      }
      if (tab) tab.location.href = data.url;
      else window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      tab?.close();
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Timed out searching Aspire — try again"
          : err instanceof Error
            ? err.message
            : "Couldn't find that proposal in Aspire";
      setAspireFindError(message);
    } finally {
      setFindingAspire(false);
    }
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
        rfp_date: form.rfp_date || null,
        won_date: form.won_date || null,
        invoiced_date: form.invoiced_date || null,
        paid_date: form.paid_date || null,
        appointment_date: form.appointment_date || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        property_id: form.property_id,
        aspire_link: form.aspire_link.trim() || null,
        opportunity_link: form.opportunity_link.trim() || null,
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

  // Flagging is a quick toggle — keep the modal open so the state change is seen.
  async function handleToggleFlag() {
    setFlagBusy(true);
    try {
      await onToggleFlag(deal);
    } finally {
      setFlagBusy(false);
    }
  }

  // Calendar events plotted on the milestone timeline as bold dots. Each event
  // (past only) anchors to the most recent DATED milestone at/before its date
  // and lands in the visual gap to the NEXT slot (dated or not); events before
  // the first dated milestone or after the last slot are dropped. Within a gap
  // the events subdivide it evenly (k/(N+1)); a gap over the cap collapses its
  // tail into a "+N" pill. Positions are percentages across the timeline: the
  // line runs from the first slot's center (100/12%) to the last's, in 5 gaps.
  const timelineEventDots = useMemo(() => {
    const LINE_START = 100 / 12;
    const GAP = (100 - 2 * LINE_START) / 5;
    const CAP = 5; // max dots per gap before the last becomes a "+N" pill
    const toDay = (ymd: string) => {
      const [y, m, d] = ymd.split("-").map(Number);
      return Date.UTC(y, m - 1, d);
    };
    const slotDates = [
      form.appointment_date,
      form.proposal_date,
      form.won_date,
      form.start_date,
      form.invoiced_date,
      form.paid_date,
    ].map((d) => (d && d.trim() ? d.trim() : null));
    const dated = slotDates
      .map((d, slot) => (d ? { slot, day: toDay(d) } : null))
      .filter((v): v is { slot: number; day: number } => v != null);
    if (dated.length === 0) return [];

    const now = new Date();
    const todayDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const isoToYmd = (iso: string) => {
      const dt = new Date(iso);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    };
    // Events AND correspondence both plot as dots between milestones, binned by
    // date the same way. Correspondence uses created_at; its dot scrolls the
    // strip to that record's tile rather than deep-linking to the calendar.
    type Item = { kind: "event" | "corr"; refId: number; name: string; ymd: string; day: number; stripKey?: string };
    const items: Item[] = [
      ...(deal.events ?? []).map((e): Item => {
        const ymd = isoToYmd(e.start_time);
        return { kind: "event", refId: e.id, name: e.name ?? "Event", ymd, day: toDay(ymd) };
      }),
      ...(deal.correspondence ?? []).map((c): Item => {
        const ymd = isoToYmd(c.created_at);
        const name = c.channel ? CHANNEL_META[c.channel].label : c.file_name ?? "Screenshot";
        return { kind: "corr", refId: c.id, name, ymd, day: toDay(ymd), stripKey: `c${c.id}` };
      }),
      ...stripEmails.map((e): Item => {
        const ymd = isoToYmd(e.sent_at ?? e.created_at);
        return { kind: "corr", refId: e.id, name: e.subject ?? "Email", ymd, day: toDay(ymd), stripKey: `e${e.id}` };
      }),
    ].filter((it) => it.day <= todayDay);

    const byGap = new Map<number, Item[]>();
    for (const it of items) {
      let anchor: { slot: number; day: number } | null = null;
      for (const m of dated) if (m.day <= it.day) anchor = m; // last dated milestone at/before it
      if (!anchor || anchor.slot >= 5) continue; // before first dated, or past the last slot
      if (!byGap.has(anchor.slot)) byGap.set(anchor.slot, []);
      byGap.get(anchor.slot)!.push(it);
    }

    const dots: {
      key: string;
      leftPct: number;
      href?: string;
      title: string;
      kind?: "event" | "corr";
      eventId?: number;
      stripKey?: string;
      overflow?: number;
    }[] = [];
    for (const [gap, list] of byGap) {
      list.sort((a, b) => a.day - b.day);
      const N = list.length;
      const shown: ({ kind: "item"; it: Item } | { kind: "more"; n: number })[] =
        N > CAP
          ? [
              ...list.slice(0, CAP - 1).map((it) => ({ kind: "item" as const, it })),
              { kind: "more" as const, n: N - (CAP - 1) },
            ]
          : list.map((it) => ({ kind: "item" as const, it }));
      const D = shown.length;
      shown.forEach((entry, j) => {
        const leftPct = LINE_START + gap * GAP + ((j + 1) / (D + 1)) * GAP;
        if (entry.kind === "item") {
          const it = entry.it;
          dots.push({
            key: `${gap}-${j}`,
            leftPct,
            title: `${it.name} — ${formatMilestoneDate(it.ymd)}`,
            kind: it.kind,
            ...(it.kind === "event"
              ? { href: `/calendar?event=${it.refId}`, eventId: it.refId }
              : { stripKey: it.stripKey }),
          });
        } else {
          dots.push({ key: `${gap}-more`, leftPct, title: `${entry.n} more`, overflow: entry.n });
        }
      });
    }
    return dots;
  }, [
    stripEmails,
    deal.correspondence,
    deal.events,
    form.appointment_date,
    form.proposal_date,
    form.won_date,
    form.start_date,
    form.invoiced_date,
    form.paid_date,
  ]);

  // Every strip item across the whole property, oldest-first: displayable
  // photos AND correspondence (call/email/text touchpoints or screenshots),
  // interleaved chronologically in one row above the timeline. Photos carry an
  // event id (null for reference photos) so a timeline dot can scroll its
  // event's photos in; every item carries a UTC day so a milestone node can
  // scroll to the first item on/after its date.
  const stripItems = useMemo(() => {
    const dayOf = (iso: string): number | null => {
      const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
      return Number.isFinite(y) ? Date.UTC(y, m - 1, d) : null;
    };
    type PhotoItem = {
      kind: "photo";
      key: string;
      url: string;
      eventId: number | null;
      day: number | null;
      ts: number;
      caption: string;
    };
    type CorrItem = { kind: "corr"; key: string; icon: string; day: number | null; ts: number; caption: string };
    const out: (PhotoItem | CorrItem)[] = [];
    for (const p of stripPhotos) {
      const url = dealThumbUrl(p);
      if (!url) continue;
      const iso = p.taken_at ?? p.created_at;
      out.push({ kind: "photo", key: `p${p.id}`, url, eventId: p.event_id, day: dayOf(iso), ts: new Date(iso).getTime(), caption: p.caption ?? "" });
    }
    for (const c of stripCorrespondence) {
      const icon = c.channel ? CHANNEL_META[c.channel].icon : "🖼️";
      const caption = c.channel ? CHANNEL_META[c.channel].label : c.file_name ?? "Screenshot";
      out.push({ kind: "corr", key: `c${c.id}`, icon, day: dayOf(c.created_at), ts: new Date(c.created_at).getTime(), caption });
    }
    for (const e of stripEmails) {
      const iso = e.sent_at ?? e.created_at;
      out.push({ kind: "corr", key: `e${e.id}`, icon: "📧", day: dayOf(iso), ts: new Date(iso).getTime(), caption: e.subject ?? "Email" });
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }, [stripPhotos, stripCorrespondence, stripEmails]);

  const photoStripRef = useRef<HTMLDivElement>(null);
  // Highlight state: an event id highlights all that event's photos; a single
  // item key highlights one tile (a correspondence node or a specific photo).
  const [stripEventId, setStripEventId] = useState<number | null>(null);
  const [stripActiveKey, setStripActiveKey] = useState<string | null>(null);
  const clearStripFocus = useCallback(() => {
    setStripEventId(null);
    setStripActiveKey(null);
  }, []);
  // Scroll the strip so a given child index aligns to the left edge.
  const scrollStripToIndex = useCallback((idx: number) => {
    const strip = photoStripRef.current;
    if (!strip || idx < 0) return;
    const el = strip.children[idx] as HTMLElement | undefined;
    if (el) strip.scrollTo({ left: Math.max(0, el.offsetLeft - 8), behavior: "smooth" });
  }, []);
  // An event dot: scroll to (and highlight) its event's photos.
  const focusStripEvent = useCallback(
    (eventId: number) => {
      setStripEventId(eventId);
      setStripActiveKey(null);
      scrollStripToIndex(stripItems.findIndex((it) => it.kind === "photo" && it.eventId === eventId));
    },
    [stripItems, scrollStripToIndex]
  );
  // A correspondence dot: scroll to (and highlight) that one strip tile.
  const focusStripItem = useCallback(
    (key: string) => {
      setStripEventId(null);
      setStripActiveKey(key);
      scrollStripToIndex(stripItems.findIndex((it) => it.key === key));
    },
    [stripItems, scrollStripToIndex]
  );
  // A milestone node/date: scroll to the first item on or after its date
  // (falling back to the last item when everything predates it).
  const focusStripByDay = useCallback(
    (ymd: string) => {
      if (stripItems.length === 0) return;
      const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
      if (!Number.isFinite(y)) return;
      const target = Date.UTC(y, m - 1, d);
      let idx = stripItems.findIndex((it) => it.day != null && it.day >= target);
      if (idx === -1) idx = stripItems.length - 1;
      const hit = stripItems[idx];
      setStripEventId(hit && hit.kind === "photo" ? hit.eventId : null);
      setStripActiveKey(hit && hit.kind === "corr" ? hit.key : null);
      scrollStripToIndex(idx);
    },
    [stripItems, scrollStripToIndex]
  );

  return (
    <div
      className={`${styles["modal-overlay"]} ${styles["is-fullscreen"]}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${styles["modal-panel"]} ${styles["is-fullscreen"]}`} role="dialog" aria-modal="true">
        <div className={styles["modal-head"]}>
          <div className={styles["modal-head-left"]}>
            <div>
              <h2 className={styles["modal-title"]}>{deal.deal_name}</h2>
              <span className={styles["modal-stage"]}>
                {deal.lost_at ? `${deal.stage} · Lost ${formatDateTime(deal.lost_at)}` : deal.stage}
              </span>
            </div>
          </div>
          <div className={styles["modal-head-right"]}>
            <button
              type="button"
              className={`${styles["modal-lock-btn"]} ${locked ? "" : styles["is-unlocked"]}`}
              aria-pressed={!locked}
              title={locked ? "Locked — click to edit" : "Editing — click to lock"}
              onClick={() => setLocked((l) => !l)}
            >
              {locked ? "🔒 Locked" : "🔓 Editing"}
            </button>
            <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        <form className={styles["card-edit-form"]} onSubmit={handleSubmit}>
          <div className={styles["deal-form-body"]}>
          <div className={`${styles["deal-form-fields"]} ${locked ? styles["is-locked"] : ""}`} ref={fieldsRef}>
          {deal.property_id != null && coverPhoto && dealThumbUrl(coverPhoto) && (
            <div className={styles["deal-cover-photo"]}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dealThumbUrl(coverPhoto) ?? undefined} alt="Property album cover" title="Property album cover" />
            </div>
          )}
          <section className={styles["deal-section"]}>
            <h3 className={styles["deal-section-title"]}>Deal</h3>
          <div className={styles["card-edit-field"]}>
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
            <label htmlFor="dm-description">Proposal description</label>
            <textarea id="dm-description" rows={1} value={form.proposal_description} onChange={(e) => set("proposal_description", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-company">Company</label>
            <input id="dm-company" autoComplete="off" value={form.company} onChange={(e) => set("company", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-value">Value ($)</label>
            <input id="dm-value" type="number" min="0" step="1" value={form.value} onChange={(e) => set("value", e.target.value)} />
          </div>
          </section>
          <section className={styles["deal-section"]}>
            <h3 className={styles["deal-section-title"]}>Contact</h3>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-first">Contact first name</label>
            <input id="dm-first" autoComplete="off" value={form.contact_first_name} onChange={(e) => set("contact_first_name", e.target.value)} />
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-last">Contact last name</label>
            <div className={styles["aspire-link-row"]}>
              <input id="dm-last" autoComplete="off" value={form.contact_last_name} onChange={(e) => set("contact_last_name", e.target.value)} />
              {(deal.property?.contact?.first_name ||
                deal.property?.contact?.last_name ||
                deal.property?.contact?.phone ||
                deal.property?.contact?.email) && (
                <a className={styles["open-link-btn"]} href={`/api/sales-board/${deal.id}/vcard`}>
                  👤 Add to Contacts
                </a>
              )}
            </div>
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-email">Contact email</label>
            <div className={styles["aspire-link-row"]}>
              <input id="dm-email" type="text" inputMode="email" autoComplete="off" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
              {form.contact_email.trim() && (
                <a
                  className={styles["open-link-btn"]}
                  href={`mailto:${encodeURIComponent(form.contact_email.trim())}${
                    form.proposal_number.trim()
                      ? `?subject=${encodeURIComponent(`Proposal #${form.proposal_number.trim()}`)}`
                      : ""
                  }`}
                  onClick={() => onLogCorrespondence(deal.id, "email")}
                >
                  ✉ Email
                </a>
              )}
            </div>
          </div>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-phone">Contact phone</label>
            <div className={styles["aspire-link-row"]}>
              <input id="dm-phone" type="tel" autoComplete="off" value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} />
              {form.contact_phone.replace(/[^\d+]/g, "") && (
                <a
                  className={styles["open-link-btn"]}
                  href={`tel:${form.contact_phone.replace(/[^\d+]/g, "")}`}
                  onClick={() => onLogCorrespondence(deal.id, "call")}
                >
                  📞 Call
                </a>
              )}
              {form.contact_phone.replace(/[^\d+]/g, "") && (
                <TextTemplateMenu
                  phone={form.contact_phone}
                  tokens={{
                    first_name: form.contact_first_name.trim(),
                    last_name: form.contact_last_name.trim(),
                    proposal_number: form.proposal_number.trim(),
                    proposal_description: form.proposal_description.trim(),
                  }}
                  onSend={() => onLogCorrespondence(deal.id, "text")}
                />
              )}
            </div>
          </div>
          </section>
          <section className={styles["deal-section"]}>
            <h3 className={styles["deal-section-title"]}>Proposal &amp; dates</h3>
          <div className={styles["card-edit-field"]}>
            <label htmlFor="dm-proposal-number">Proposal #</label>
            <div className={styles["aspire-link-row"]}>
              <input id="dm-proposal-number" autoComplete="off" value={form.proposal_number} onChange={(e) => set("proposal_number", e.target.value)} />
              {form.proposal_number.trim() && (
                <button
                  type="button"
                  className={styles["aspire-parse-btn"]}
                  disabled={findingAspire}
                  title={
                    form.aspire_link.trim()
                      ? "Open this proposal in Aspire"
                      : "Search Aspire for this proposal number and open it"
                  }
                  onClick={() => handleFindInAspire()}
                >
                  {findingAspire
                    ? "Searching Aspire…"
                    : form.aspire_link.trim()
                      ? "Open in Aspire ↗"
                      : "Find in Aspire"}
                </button>
              )}
              {form.proposal_number.trim() && form.aspire_link.trim() && (
                <button
                  type="button"
                  className={styles["aspire-parse-btn"]}
                  disabled={findingAspire}
                  title="Search Aspire again and replace the saved link"
                  aria-label="Re-find this proposal in Aspire"
                  onClick={() => handleFindInAspire({ refresh: true })}
                >
                  ↻
                </button>
              )}
            </div>
            {findingAspire && aspireLiveView && (
              <div className={styles["aspire-live-row"]}>
                <a
                  className={styles["open-link-btn"]}
                  href={aspireLiveView.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  👁 Watch live
                </a>
                <span className={styles["aspire-live-note"]}>
                  {aspireLiveView.note || "See what the search is doing in Aspire right now"}
                </span>
              </div>
            )}
            {aspireCandidates.length > 0 && (
              <div className={styles["aspire-candidates"]}>
                <span className={styles["aspire-candidates-label"]}>
                  More than one Aspire result matched — which one?
                </span>
                {aspireCandidates.map((candidate) => (
                  <button
                    key={candidate.index}
                    type="button"
                    className={styles["aspire-candidate"]}
                    disabled={findingAspire}
                    onClick={() => handleFindInAspire({ resultIndex: candidate.index })}
                  >
                    <span className={styles["aspire-candidate-title"]}>{candidate.title}</span>
                    {candidate.subtitle && (
                      <span className={styles["aspire-candidate-sub"]}>{candidate.subtitle}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {aspireFindError && <div className={styles["card-edit-error"]}>{aspireFindError}</div>}
          </div>
          {/* Key dates, grouped and ordered by the pipeline stage each one
              belongs to: Lead → Propose → Sent → Sold → Project Management. */}
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <span className={styles["card-edit-subhead"]}>Key dates</span>
            <div className={styles["date-stage-grid"]}>
              {renderKeyDate("Lead", "RFP date", "dm-rfp-date", "rfp_date")}
              {renderKeyDate("Propose", "Appointment date", "dm-appointment-date", "appointment_date")}
              {renderKeyDate("Sent", "Proposal date", "dm-proposal-date", "proposal_date")}
              {renderKeyDate("Sold", "Won date", "dm-won-date", "won_date")}
              {renderKeyDate("Project Management", "Production start day", "dm-start-date", "start_date")}
              {renderKeyDate("Project Management", "Production stop day", "dm-end-date", "end_date", form.start_date || undefined)}
              {renderKeyDate("Invoiced", "Invoiced date", "dm-invoiced-date", "invoiced_date")}
              {renderKeyDate("Paid in Full", "Paid in full date", "dm-paid-date", "paid_date")}
            </div>
          </div>
          </section>
          <section className={styles["deal-section"]}>
            <h3 className={styles["deal-section-title"]}>Links &amp; files</h3>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-opportunity-link">Aspire opportunity link</label>
            <div className={styles["aspire-link-row"]}>
              <input
                id="dm-opportunity-link"
                type="url"
                autoComplete="off"
                placeholder="https://cloud.youraspire.com/..."
                value={form.opportunity_link}
                onChange={(e) => set("opportunity_link", e.target.value)}
              />
              {form.opportunity_link.trim() && (
                <a
                  className={styles["open-link-btn"]}
                  href={form.opportunity_link.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open ↗
                </a>
              )}
            </div>
          </div>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-proposal-link">Proposal link</label>
            <div className={styles["aspire-link-row"]}>
              <input
                id="dm-proposal-link"
                type="url"
                autoComplete="off"
                placeholder="https://..."
                value={form.aspire_link}
                onChange={(e) => set("aspire_link", e.target.value)}
              />
              {form.aspire_link.trim() && (
                <a
                  className={styles["open-link-btn"]}
                  href={form.aspire_link.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open ↗
                </a>
              )}
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
            <label>Tools</label>
            <div className={styles["tool-actions"]}>
              {/* Estimate: open the existing one, or create it. */}
              {estimateInfo === undefined ? (
                <span className={styles["proposal-pdf-busy"]}>Loading…</span>
              ) : estimateInfo ? (
                <Link href={`/estimator/${estimateInfo.id}`} className={styles["tool-btn"]}>
                  📐 Open estimate
                  {estimateInfo.total != null
                    ? ` · ${estimateInfo.total.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`
                    : ""}
                </Link>
              ) : (
                <button type="button" className={styles["tool-btn"]} onClick={handleCreateEstimate} disabled={creatingEstimate}>
                  {creatingEstimate ? "Creating…" : "📐 Create estimate"}
                </button>
              )}

              {/* Designs: existing renderings, plus a new one. */}
              {designs === undefined ? (
                <span className={styles["proposal-pdf-busy"]}>Loading…</span>
              ) : (
                <>
                  {designs.map((d) => (
                    <Link key={d.id} href={`/design/${d.id}`} className={styles["tool-btn"]}>
                      🎨 {d.name}
                    </Link>
                  ))}
                  <button type="button" className={styles["tool-btn"]} onClick={handleCreateDesign} disabled={creatingDesign}>
                    {creatingDesign ? "Creating…" : "🎨 New design"}
                  </button>
                </>
              )}
            </div>
          </div>
          </section>
          <section className={styles["deal-section"]}>
            <h3 className={styles["deal-section-title"]}>Attachments</h3>
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
          </section>
          <section className={styles["deal-section"]}>
            <h3 className={styles["deal-section-title"]}>Correspondence</h3>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label>Correspondence with client</label>
            {deal.correspondence.filter((c) => c.parent_id == null).length === 0 ? (
              <p className={styles["deal-emails-empty"]}>
                Log a call, email, or text from the Contact section above — then attach screenshots to that entry here.
              </p>
            ) : (
              <div className={styles["attachments-list"]}>
                {deal.correspondence
                  .filter((c) => c.parent_id == null)
                  .map((item) => {
                    const shots = deal.correspondence.filter((c) => c.parent_id === item.id);
                    return (
                      <div key={item.id} className={styles["corr-entry"]}>
                        <div className={styles["attachment-row"]}>
                          {item.channel ? (
                            <div className={styles["attachment-link"]} style={{ cursor: "default" }}>
                              <span className={styles["attachment-icon"]}>{CHANNEL_META[item.channel].icon}</span>
                              <span className={styles["attachment-name"]}>{CHANNEL_META[item.channel].label}</span>
                              <span className={styles["attachment-date"]}>{formatDateTime(item.created_at)}</span>
                            </div>
                          ) : (
                            <a
                              href={dealCorrespondenceUrl(item.storage_path ?? "")}
                              target="_blank"
                              rel="noreferrer"
                              className={styles["attachment-link"]}
                            >
                              <span className={styles["attachment-icon"]}>🖼️</span>
                              <span className={styles["attachment-name"]}>{item.file_name}</span>
                              <span className={styles["attachment-date"]}>{formatDateTime(item.created_at)}</span>
                            </a>
                          )}
                          <button
                            type="button"
                            className={styles["attachment-remove"]}
                            aria-label="Delete correspondence"
                            disabled={deletingCorrespondenceId === item.id}
                            onClick={() => handleDeleteCorrespondenceClick(item.id)}
                          >
                            ×
                          </button>
                        </div>
                        {shots.length > 0 && (
                          <div className={styles["corr-shots"]}>
                            {shots.map((s) => (
                              <div key={s.id} className={styles["corr-shot"]}>
                                <a
                                  href={dealCorrespondenceUrl(s.storage_path ?? "")}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={s.file_name ?? "Screenshot"}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={dealCorrespondenceUrl(s.storage_path ?? "")} alt={s.file_name ?? "Screenshot"} />
                                </a>
                                <button
                                  type="button"
                                  className={styles["corr-shot-remove"]}
                                  aria-label="Delete screenshot"
                                  disabled={deletingCorrespondenceId === s.id}
                                  onClick={() => handleDeleteCorrespondenceClick(s.id)}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className={styles["corr-attach-actions"]}>
                          <label className={styles["corr-attach-btn"]}>
                            📎 Attach image
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(e) => {
                                const files = e.target.files;
                                if (files) Array.from(files).forEach((file) => uploadCorrespondenceFile(file, item.id));
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className={styles["corr-attach-btn"]}
                            onClick={() => handlePasteCorrespondenceClick(item.id)}
                          >
                            📋 Paste
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
            {uploadingCorrespondence && <span className={styles["proposal-pdf-busy"]}>Uploading…</span>}
            {correspondencePasteError && <div className={styles["card-edit-error"]}>{correspondencePasteError}</div>}
            <textarea
              ref={correspondencePasteTargetRef}
              className={styles["paste-target"]}
              aria-hidden="true"
              tabIndex={-1}
              value=""
              onChange={() => {}}
            />
          </div>
          </section>
          <section className={styles["deal-section"]}>
            <h3 className={styles["deal-section-title"]}>Emails</h3>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            {stripEmails.length === 0 ? (
              <p className={styles["deal-emails-empty"]}>
                No emails yet. Forward an email to the property&apos;s inbound address and it&apos;ll appear here.
              </p>
            ) : (
              <div className={styles["deal-emails-list"]}>
                {[...stripEmails].reverse().map((em) => (
                  <details key={em.id} className={styles["deal-email"]}>
                    <summary className={styles["deal-email-head"]}>
                      <span className={styles["deal-email-icon"]}>📧</span>
                      <span className={styles["deal-email-meta"]}>
                        <span className={styles["deal-email-subject"]}>{em.subject || "(no subject)"}</span>
                        <span className={styles["deal-email-sub"]}>
                          {em.from_name || em.from_address || "Unknown sender"}
                          {em.sent_at ? ` — ${formatDateTime(em.sent_at)}` : ""}
                        </span>
                      </span>
                    </summary>
                    {em.body_text ? (
                      <pre className={styles["deal-email-body"]}>{em.body_text}</pre>
                    ) : em.snippet ? (
                      <p className={styles["deal-email-body"]}>{em.snippet}</p>
                    ) : null}
                  </details>
                ))}
              </div>
            )}
          </div>
          </section>
          <TranscriptsSection
            deal={deal}
            onAdd={onAddTranscript}
            onEdit={onEditTranscript}
            onDelete={onDeleteTranscript}
          />
          <section className={styles["deal-section"]}>
            <h3 className={styles["deal-section-title"]}>Property</h3>
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label htmlFor="dm-jobsite">Jobsite address</label>
            <div className={styles["aspire-link-row"]}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <PropertyPicker
                  id="dm-jobsite"
                  propertyOptions={propertyOptions}
                  value={form.property_id}
                  onChange={(propertyId) => setForm((f) => ({ ...f, property_id: propertyId }))}
                  onCreated={onPropertyCreated}
                />
              </div>
              {deal.property && (deal.property.latitude != null || deal.property.address) && (
                <a
                  className={styles["open-link-btn"]}
                  href={
                    deal.property.latitude != null && deal.property.longitude != null
                      ? `https://maps.apple.com/?ll=${deal.property.latitude},${deal.property.longitude}&z=20&q=${encodeURIComponent(
                          deal.property.address || "Jobsite"
                        )}`
                      : `https://maps.apple.com/?q=${encodeURIComponent(deal.property.address)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  📍 Map
                </a>
              )}
              {deal.property && (deal.property.latitude != null || deal.property.address) && (
                <a
                  className={styles["open-link-btn"]}
                  href={`https://maps.apple.com/?dirflg=d&daddr=${encodeURIComponent(
                    deal.property.latitude != null && deal.property.longitude != null
                      ? `${deal.property.latitude},${deal.property.longitude}`
                      : deal.property.address
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🧭 Directions
                </a>
              )}
            </div>
            <GeocodeStatus deal={deal} />
          </div>
          <RelatedDeals deals={relatedDeals} onSelectDeal={onSelectDeal} />
          <div className={`${styles["card-edit-field"]} ${styles["is-full"]}`}>
            <label>Next action</label>
            {deal.next_action ? (
              <div className={styles["next-action-display"]}>{deal.next_action}</div>
            ) : (
              <div className={styles["next-action-display-empty"]}>No next action set</div>
            )}
            <div className={styles["next-action-links"]}>
              <Link href={`/tasks?deal=${deal.id}`} className={styles["geocode-link"]}>
                Manage tasks →
              </Link>
              <AddTaskInline dealId={deal.id} currentNextAction={deal.next_action} onAdded={onTaskAdded} />
            </div>
          </div>
          </section>
          <section className={styles["deal-section"]}>
            <h3 className={styles["deal-section-title"]}>Photos</h3>
          {(deal.site_plan_photos ?? []).length > 0 && (
            <div className={styles["photo-events"]}>
              <div className={styles["photo-event-group"]}>
                <div className={styles["photo-event-header"]}>
                  <span className={styles["event-type-badge"]}>SITE PLAN</span>
                  <span className={styles["photo-event-name"]}>Site Plan</span>
                  <span className={styles["photo-event-date"]}>from the estimator</span>
                </div>
                <div className={styles["photo-row"]}>
                  {(deal.site_plan_photos ?? []).map((photo) => {
                    const url = dealThumbUrl(photo);
                    return (
                      <a
                        key={photo.id}
                        className={styles["photo-thumb"]}
                        href={url ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        title="Open site plan"
                      >
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt="Site plan" />
                        ) : (
                          <span className={styles["photo-thumb-placeholder"]}>🗺</span>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

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
            {deal.property_id != null && referencePhotos.length > 0 && (
              <div className={styles["photo-event-group"]}>
                <div className={styles["photo-event-header"]}>
                  <span className={styles["event-type-badge"]}>Reference</span>
                  <span className={styles["photo-event-name"]}>Property reference photos</span>
                  {deal.property && (
                    <Link href={`/properties?property=${deal.property.id}`} className={styles["photo-event-link"]}>
                      View on property →
                    </Link>
                  )}
                </div>
                <div className={styles["photo-row"]}>
                  {referencePhotos.map((photo) => {
                    const thumbUrl = dealThumbUrl(photo);
                    return (
                      <div key={photo.id} className={styles["photo-thumb"]}>
                        {thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumbUrl} alt={photo.caption ?? "Reference photo"} />
                        ) : (
                          <span className={styles["photo-thumb-placeholder"]}>🖼</span>
                        )}
                        <button
                          type="button"
                          className={styles["photo-remove"]}
                          aria-label="Delete reference photo"
                          onClick={() => handleDeleteReferencePhoto(photo.id)}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className={styles["photo-add-row"]}>
              <label className={styles["photo-add"]}>
                + Photo
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files) {
                      Array.from(files).forEach((file) => uploadPhotoFile(file));
                    }
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                className={styles["photo-add-hint"]}
                title="Paste an image from the clipboard"
                onClick={() => {
                  setPhotoPasteError("Now press ⌘V / Ctrl+V to paste the image");
                  armPhotoPasteTarget();
                }}
              >
                {uploadingPhoto
                  ? "Uploading…"
                  : "or press ⌘V / Ctrl+V to paste an image into the property's reference photos"}
              </button>
              <textarea
                ref={photoPasteTargetRef}
                className={styles["paste-target"]}
                aria-hidden="true"
                tabIndex={-1}
                value=""
                onChange={() => {}}
              />
            </div>
            {photoPasteError && <div className={styles["card-edit-error"]}>{photoPasteError}</div>}
          </div>
          </section>
          </div>
          </div>

          <div className={styles["deal-form-footer"]}>
          {/* One continuous, horizontally-scrolling row of every photo AND
              correspondence across the whole property (all its deals +
              reference photos), sitting above the timeline. Hovering a timeline
              dot scrolls to that event's photos; hovering a milestone node
              scrolls to the first item on/after its date — so you can scroll
              back to earlier events even when they belong to another deal. */}
          {stripItems.length > 0 && (
            <div className={styles["deal-photo-strip"]} ref={photoStripRef} onMouseLeave={clearStripFocus}>
              {stripItems.map((it) =>
                it.kind === "photo" ? (
                  <Link
                    key={it.key}
                    href={it.eventId != null ? `/calendar?event=${it.eventId}` : "/calendar"}
                    data-strip-event={it.eventId ?? undefined}
                    className={`${styles["deal-photo-strip-item"]} ${
                      (it.eventId != null && stripEventId === it.eventId) || stripActiveKey === it.key
                        ? styles["is-active"]
                        : ""
                    }`}
                    title={it.caption || undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.url} alt="" />
                  </Link>
                ) : (
                  <span
                    key={it.key}
                    className={`${styles["deal-photo-strip-item"]} ${styles["is-correspondence"]} ${
                      stripActiveKey === it.key ? styles["is-active"] : ""
                    }`}
                    title={it.caption || undefined}
                  >
                    <span className={styles["deal-photo-strip-icon"]}>{it.icon}</span>
                  </span>
                )
              )}
            </div>
          )}
          {/* Full-width milestone timeline — the same lifecycle shown in the
              Next Actions page's first column, stretched across the modal. */}
          <div className={styles["deal-timeline"]} onMouseLeave={clearStripFocus}>
            <div className={styles["deal-timeline-line"]} />
            {MILESTONES.map((m) => {
              const date =
                m.key === "appointment" ? form.appointment_date
                : m.key === "proposal" ? form.proposal_date
                : m.key === "won" ? form.won_date
                : m.key === "production" ? form.start_date
                : m.key === "invoiced" ? form.invoiced_date
                : form.paid_date;
              const fulfilled = !!date;
              return (
                <div
                  key={m.key}
                  className={styles["deal-timeline-slot"]}
                  title={`${m.label}${fulfilled ? ` — ${formatMilestoneDate(date)}` : " — not yet reached"}`}
                  onMouseEnter={fulfilled ? () => focusStripByDay(date) : undefined}
                >
                  <span
                    className={`${styles["deal-timeline-icon"]} ${fulfilled ? styles["is-fulfilled"] : styles["is-pending"]}`}
                  >
                    {m.icon}
                  </span>
                  <span className={styles["deal-timeline-label"]}>{m.label}</span>
                  <span className={styles["deal-timeline-date"]}>{fulfilled ? formatMilestoneDate(date) : "—"}</span>
                </div>
              );
            })}
            {timelineEventDots.map((dot) =>
              dot.overflow ? (
                <span
                  key={dot.key}
                  className={styles["deal-timeline-eventMore"]}
                  style={{ left: `${dot.leftPct}%` }}
                  title={dot.title}
                >
                  +{dot.overflow}
                </span>
              ) : dot.kind === "corr" ? (
                <button
                  key={dot.key}
                  type="button"
                  className={styles["deal-timeline-event"]}
                  style={{ left: `${dot.leftPct}%` }}
                  aria-label={dot.title}
                  onMouseEnter={() => dot.stripKey && focusStripItem(dot.stripKey)}
                  onFocus={() => dot.stripKey && focusStripItem(dot.stripKey)}
                  onClick={() => dot.stripKey && focusStripItem(dot.stripKey)}
                >
                  <span className={styles["deal-timeline-event-dot"]} />
                  <span className={styles["deal-timeline-event-tip"]}>{dot.title}</span>
                </button>
              ) : (
                <Link
                  key={dot.key}
                  href={dot.href!}
                  className={styles["deal-timeline-event"]}
                  style={{ left: `${dot.leftPct}%` }}
                  aria-label={dot.title}
                  onMouseEnter={() => dot.eventId != null && focusStripEvent(dot.eventId)}
                  onFocus={() => dot.eventId != null && focusStripEvent(dot.eventId)}
                >
                  <span className={styles["deal-timeline-event-dot"]} />
                  <span className={styles["deal-timeline-event-tip"]}>{dot.title}</span>
                </Link>
              )
            )}
          </div>

          {error && <div className={styles["card-edit-error"]}>{error}</div>}

          <div className={styles["modal-actions"]}>
            <div className={styles["modal-actions-left"]}>
              <button
                type="button"
                className={`${styles["modal-flag"]} ${deal.flagged ? styles["is-flagged"] : ""}`}
                disabled={flagBusy}
                onClick={handleToggleFlag}
                title="Flag a loose end to tie up (keeps the stage; reopens if closed)"
              >
                {deal.flagged ? "🚩 Unflag" : "⚑ Flag"}
              </button>
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
          </div>
        </form>
      </div>
    </div>
  );
}
