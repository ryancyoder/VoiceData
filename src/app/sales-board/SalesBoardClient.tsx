"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./sales-board.module.css";
import { STAGES, formatPropertyLabel, type Deal, type DealInput, type Stage } from "@/lib/salesBoard";
import DealCard, { type UiDeal } from "./DealCard";
import DealModal from "./DealModal";
import LostModal from "./LostModal";
import { fetchWithTimeout } from "@/lib/withTimeout";

const PHOTO_UPLOAD_TIMEOUT_MS = 60000;
const MATCH_FETCH_TIMEOUT_MS = 8000;

interface AddressMatch {
  id: number;
  address: string;
  contactLastName: string | null;
  distanceMeters: number;
}

const STAGE_COLORS: Record<Stage, string> = {
  Lead: "var(--c-lead)",
  Propose: "var(--c-propose)",
  Sent: "var(--c-send)",
  Sold: "var(--c-sold)",
  Scheduled: "var(--c-schedule)",
  "Project Management": "var(--c-pm)",
  "Job Costing": "var(--c-jobcosting)",
  Invoiced: "var(--c-invoiced)",
  "Paid in Full": "var(--c-paid)",
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const EMPTY_ADD_FORM = {
  deal_name: "",
  company: "",
  value: "",
  contact_first_name: "",
  contact_last_name: "",
  contact_email: "",
  contact_phone: "",
  proposal_number: "",
  proposal_date: "",
  appointment_date: "",
  jobsite_address: "",
  next_action: "",
  proposal_description: "",
};

function sortDeals(list: UiDeal[], mode: string) {
  const sorted = [...list];
  if (mode === "value_desc") sorted.sort((a, b) => (b.value || 0) - (a.value || 0));
  else if (mode === "value_asc") sorted.sort((a, b) => (a.value || 0) - (b.value || 0));
  else if (mode === "alpha_asc") sorted.sort((a, b) => a.deal_name.localeCompare(b.deal_name));
  else if (mode === "alpha_desc") sorted.sort((a, b) => b.deal_name.localeCompare(a.deal_name));
  return sorted;
}

function nextValueSort(current: string) {
  if (current === "value_desc") return "value_asc";
  if (current === "value_asc") return "";
  return "value_desc";
}

function nextAlphaSort(current: string) {
  if (current === "alpha_asc") return "alpha_desc";
  if (current === "alpha_desc") return "";
  return "alpha_asc";
}

interface DragState {
  id: number;
  pointerId: number;
  handle: HTMLElement;
  card: HTMLElement;
  ghost: HTMLElement;
  offsetX: number;
  offsetY: number;
  currentColumn: HTMLElement | null;
}

export default function SalesBoardClient({ initialDeals }: { initialDeals: Deal[] }) {
  const router = useRouter();
  const [deals, setDeals] = useState<UiDeal[]>(initialDeals);
  const [activeDealId, setActiveDealId] = useState<number | null>(null);
  const [lostModalOpen, setLostModalOpen] = useState(false);
  const [showDescriptions, setShowDescriptions] = useState(false);
  const [showNextAction, setShowNextAction] = useState(false);
  const [columnSortState, setColumnSortState] = useState<Record<string, string>>({});
  const [columnCollapsedState, setColumnCollapsedState] = useState<Record<string, boolean>>({});
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState("");
  const [addAddressMatches, setAddAddressMatches] = useState<AddressMatch[]>([]);
  const [addMatchingAddress, setAddMatchingAddress] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  const activeDeals = deals.filter((d) => !d.lost_at);
  const lostCount = deals.length - activeDeals.length;
  const totalValue = activeDeals.reduce((sum, d) => sum + (d.value || 0), 0);
  const closedValue = activeDeals
    .filter((d) => d.stage === "Paid in Full")
    .reduce((sum, d) => sum + (d.value || 0), 0);

  async function refreshBoard() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/sales-board");
      const data = await res.json();
      if (res.ok) setDeals(data.deals);
    } finally {
      setRefreshing(false);
    }
  }

  function moveDeal(id: number, stage: Stage) {
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stage === stage || deal._pending) return;
    const previousStage = deal.stage;
    const name = deal.deal_name;
    setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, stage, _pending: true, _error: undefined } : d)));

    fetch(`/api/sales-board/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update stage");
        setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, _pending: false } : d)));
      })
      .catch((err) => {
        setDeals((ds) =>
          ds.map((d) => (d.id === id ? { ...d, stage: previousStage, _pending: false } : d))
        );
        showToast(`Couldn't move "${name}" — ${err instanceof Error ? err.message : "try again"}`);
      });
  }

  function handleDragStart(e: React.PointerEvent<HTMLSpanElement>, deal: UiDeal) {
    e.preventDefault();
    const handle = e.currentTarget;
    const card = handle.closest<HTMLElement>("[data-card]");
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.classList.add(styles["drag-ghost"]);
    ghost.style.width = rect.width + "px";
    ghost.style.left = rect.left + "px";
    ghost.style.top = rect.top + "px";
    document.body.appendChild(ghost);
    card.classList.add(styles["is-dragging"]);

    const state: DragState = {
      id: deal.id,
      pointerId: e.pointerId,
      handle,
      card,
      ghost,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      currentColumn: null,
    };
    dragStateRef.current = state;
    handle.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const s = dragStateRef.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      s.ghost.style.left = ev.clientX - s.offsetX + "px";
      s.ghost.style.top = ev.clientY - s.offsetY + "px";
      s.ghost.style.visibility = "hidden";
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      s.ghost.style.visibility = "";
      const columnEl = el ? (el as HTMLElement).closest<HTMLElement>("[data-column]") : null;
      if (columnEl !== s.currentColumn) {
        if (s.currentColumn) s.currentColumn.classList.remove(styles["is-dragover"]);
        if (columnEl) columnEl.classList.add(styles["is-dragover"]);
        s.currentColumn = columnEl;
      }
    }

    function onEnd(ev: PointerEvent) {
      const s = dragStateRef.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      const targetColumn = s.currentColumn;
      const dealId = s.id;

      s.card.classList.remove(styles["is-dragging"]);
      if (s.currentColumn) s.currentColumn.classList.remove(styles["is-dragover"]);
      s.ghost.remove();
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
      dragStateRef.current = null;

      if (targetColumn) {
        moveDeal(dealId, targetColumn.dataset.stage as Stage);
      }
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  async function handleSaveDeal(id: number, updates: Partial<DealInput>) {
    const res = await fetch(`/api/sales-board/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save");
    // A full refetch (rather than patching local state with the response)
    // keeps the deal's joined property/contact correct — editing contact
    // fields or the jobsite address can change which property (and which
    // contact) this deal points to, or mutate a contact shared by other
    // deals at the same property.
    await refreshBoard();
  }

  async function handleDeleteDeal(deal: Deal) {
    setActiveDealId(null);
    const previous = deals;
    setDeals((ds) => ds.filter((d) => d.id !== deal.id));
    try {
      const res = await fetch(`/api/sales-board/${deal.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete deal");
      showToast(`Deleted "${deal.deal_name}"`);
    } catch (err) {
      setDeals(previous);
      showToast(`Couldn't delete "${deal.deal_name}" — ${err instanceof Error ? err.message : "try again"}`);
    }
  }

  async function handleToggleLost(deal: Deal) {
    const lost = !deal.lost_at;
    const previous = deals;
    const lostAt = lost ? new Date().toISOString() : null;
    setDeals((ds) => ds.map((d) => (d.id === deal.id ? { ...d, lost_at: lostAt } : d)));
    try {
      const res = await fetch(`/api/sales-board/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lost_at: lostAt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setDeals((ds) => ds.map((d) => (d.id === deal.id ? { ...d, ...data.deal } : d)));
      showToast(lost ? `Marked "${deal.deal_name}" as lost` : `Restored "${deal.deal_name}" to the pipeline`);
    } catch (err) {
      setDeals(previous);
      showToast(`Couldn't update "${deal.deal_name}" — ${err instanceof Error ? err.message : "try again"}`);
      throw err;
    }
  }

  async function handleUploadPhoto(dealId: number, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetchWithTimeout(
        `/api/sales-board/${dealId}/photos`,
        { method: "POST", body: formData },
        PHOTO_UPLOAD_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload photo");
      // Which event the photo landed in isn't known client-side (it's
      // resolved server-side from GPS/time/deal), so a full refresh is
      // simpler and more correct than trying to reconstruct that nesting.
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Upload timed out — try again"
          : err instanceof Error
            ? err.message
            : "Failed to upload photo";
      showToast(message);
    }
  }

  async function handleUploadProposalPdf(dealId: number, file: File) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetchWithTimeout(
        `/api/sales-board/${dealId}/proposal-pdf`,
        { method: "POST", body: formData },
        PHOTO_UPLOAD_TIMEOUT_MS
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to upload PDF");
      setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, ...data.deal } : d)));
    } catch (err) {
      const message =
        err instanceof Error && err.name === "AbortError"
          ? "Upload timed out — try again"
          : err instanceof Error
            ? err.message
            : "Failed to upload PDF";
      showToast(message);
    }
  }

  async function handleDeleteProposalPdf(dealId: number) {
    const previous = deals;
    setDeals((ds) => ds.map((d) => (d.id === dealId ? { ...d, proposal_pdf_path: null } : d)));
    try {
      const res = await fetch(`/api/sales-board/${dealId}/proposal-pdf`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove PDF");
    } catch (err) {
      setDeals(previous);
      showToast(err instanceof Error ? err.message : "Failed to remove PDF");
    }
  }

  async function handleDeletePhoto(dealId: number, photoId: number) {
    const previous = deals;
    setDeals((ds) =>
      ds.map((d) =>
        d.id === dealId
          ? { ...d, events: d.events.map((e) => ({ ...e, photos: e.photos.filter((p) => p.id !== photoId) })) }
          : d
      )
    );
    try {
      const res = await fetch(`/api/sales-board/${dealId}/photos/${photoId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete photo");
    } catch (err) {
      setDeals(previous);
      showToast(err instanceof Error ? err.message : "Failed to delete photo");
    }
  }

  function openNewDealForm() {
    setAddFormOpen(true);
  }

  function closeNewDealForm() {
    setAddFormOpen(false);
    setAddForm(EMPTY_ADD_FORM);
    setAddError("");
    setAddAddressMatches([]);
  }

  // Same rationale as DealModal's checkAddressMatch: catches a property
  // already on file under slightly different wording before this deal
  // spins up a near-duplicate one.
  async function checkAddAddressMatch(address: string) {
    const trimmed = address.trim();
    if (!trimmed) {
      setAddAddressMatches([]);
      return;
    }
    setAddMatchingAddress(true);
    try {
      const res = await fetchWithTimeout(
        "/api/properties/match-address",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: trimmed }) },
        MATCH_FETCH_TIMEOUT_MS
      );
      const data = await res.json();
      setAddAddressMatches(res.ok ? data.candidates ?? [] : []);
    } catch {
      setAddAddressMatches([]);
    } finally {
      setAddMatchingAddress(false);
    }
  }

  function applyAddMatchedAddress(match: AddressMatch) {
    setAddForm((f) => ({ ...f, jobsite_address: match.address }));
    setAddAddressMatches([]);
  }

  async function handleCreateDeal(e: React.FormEvent) {
    e.preventDefault();
    const name = addForm.deal_name.trim();
    if (!name || addSubmitting) return;
    setAddSubmitting(true);
    setAddError("");
    try {
      const res = await fetch("/api/sales-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deal_name: name,
          company: addForm.company.trim() || null,
          value: addForm.value ? Number(addForm.value) : null,
          contact_first_name: addForm.contact_first_name.trim() || null,
          contact_last_name: addForm.contact_last_name.trim() || null,
          contact_email: addForm.contact_email.trim() || null,
          contact_phone: addForm.contact_phone.trim() || null,
          proposal_number: addForm.proposal_number.trim() || null,
          proposal_date: addForm.proposal_date || null,
          appointment_date: addForm.appointment_date || null,
          jobsite_address: addForm.jobsite_address.trim() || null,
          next_action: addForm.next_action.trim() || null,
          proposal_description: addForm.proposal_description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create deal");
      // A full refetch (rather than appending the raw response) ensures the
      // new deal's joined property/contact are populated correctly.
      await refreshBoard();
      closeNewDealForm();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create deal");
    } finally {
      setAddSubmitting(false);
    }
  }

  const activeDeal = activeDealId != null ? deals.find((d) => d.id === activeDealId) ?? null : null;
  const relatedDeals =
    activeDeal && activeDeal.property_id != null
      ? deals.filter((d) => d.property_id === activeDeal.property_id && d.id !== activeDeal.id)
      : [];

  return (
    <div className={styles.salesBoard}>
      <div className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles["brand-mark"]}>
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M4 19V10M11 19V5M18 19V13"
                stroke="white"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className={styles["brand-row"]}>
              <h1>Sales Board</h1>
            </div>
            <p>
              Deals moving through the pipeline ·{" "}
              <Link href="/photos" className={styles["brand-back"]}>
                Photos
              </Link>{" "}
              ·{" "}
              <Link href="/calendar" className={styles["brand-back"]}>
                Calendar
              </Link>{" "}
              ·{" "}
              <Link href="/properties" className={styles["brand-back"]}>
                Properties
              </Link>{" "}
              ·{" "}
              <Link href="/admin/geocode-backfill" className={styles["brand-back"]}>
                Geocode backfill
              </Link>{" "}
              ·{" "}
              <Link href="/" className={styles["brand-back"]}>
                ← VoiceData
              </Link>
            </p>
          </div>
        </div>

        <div className={styles.stats}>
          <button
            type="button"
            className={`${styles["refresh-btn"]} ${styles["desc-toggle"]} ${showDescriptions ? styles["is-active"] : ""}`}
            onClick={() => setShowDescriptions((v) => !v)}
            title="Show/hide proposal descriptions on cards"
          >
            Descriptions
          </button>
          <button
            type="button"
            className={`${styles["refresh-btn"]} ${styles["desc-toggle"]} ${showNextAction ? styles["is-active"] : ""}`}
            onClick={() => setShowNextAction((v) => !v)}
            title="Show/hide next action on cards"
          >
            Next Action
          </button>
          <button
            type="button"
            className={styles["refresh-btn"]}
            onClick={refreshBoard}
            disabled={refreshing}
            title="Refresh now"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />
            </svg>
            <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
          <div className={styles.stat}>
            <span className={styles["stat-value"]}>{activeDeals.length}</span>
            <span className={styles["stat-label"]}>Deals</span>
          </div>
          <div className={styles.stat}>
            <span className={styles["stat-value"]}>{currency.format(totalValue)}</span>
            <span className={styles["stat-label"]}>Pipeline</span>
          </div>
          <div className={`${styles.stat} ${styles["is-success"]}`}>
            <span className={styles["stat-value"]}>{currency.format(closedValue)}</span>
            <span className={styles["stat-label"]}>Paid in full</span>
          </div>
          <button type="button" className={`${styles.stat} ${styles["lost-stat"]}`} onClick={() => setLostModalOpen(true)} title="View lost deals">
            <span className={styles["stat-value"]}>{lostCount}</span>
            <span className={styles["stat-label"]}>Lost</span>
          </button>
        </div>
      </div>

      <div className={styles["add-bar"]}>
        <div className={styles["add-bar-row"]}>
          {!addFormOpen && (
            <button type="button" className={styles["new-deal-toggle"]} onClick={openNewDealForm}>
              + New deal
            </button>
          )}
        </div>
        <form className={`${styles["add-form"]} ${addFormOpen ? styles["is-open"] : ""}`} onSubmit={handleCreateDeal}>
          <div className={styles.field}>
            <label htmlFor="f-name">Customer last name</label>
            <input
              id="f-name"
              required
              maxLength={120}
              autoComplete="off"
              placeholder="Maar"
              value={addForm.deal_name}
              onChange={(e) => setAddForm((f) => ({ ...f, deal_name: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="f-company">Company</label>
            <input
              id="f-company"
              maxLength={120}
              autoComplete="off"
              placeholder="Optional"
              value={addForm.company}
              onChange={(e) => setAddForm((f) => ({ ...f, company: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="f-value">Value ($)</label>
            <input
              id="f-value"
              type="number"
              min="0"
              step="1"
              placeholder="Optional"
              value={addForm.value}
              onChange={(e) => setAddForm((f) => ({ ...f, value: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="f-contact-first">Contact first name</label>
            <input
              id="f-contact-first"
              maxLength={120}
              autoComplete="off"
              value={addForm.contact_first_name}
              onChange={(e) => setAddForm((f) => ({ ...f, contact_first_name: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="f-contact-last">Contact last name</label>
            <input
              id="f-contact-last"
              maxLength={120}
              autoComplete="off"
              value={addForm.contact_last_name}
              onChange={(e) => setAddForm((f) => ({ ...f, contact_last_name: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="f-contact-email">Contact email</label>
            <input
              id="f-contact-email"
              type="text"
              inputMode="email"
              maxLength={200}
              autoComplete="off"
              value={addForm.contact_email}
              onChange={(e) => setAddForm((f) => ({ ...f, contact_email: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="f-contact-phone">Contact phone</label>
            <input
              id="f-contact-phone"
              type="tel"
              maxLength={40}
              autoComplete="off"
              value={addForm.contact_phone}
              onChange={(e) => setAddForm((f) => ({ ...f, contact_phone: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="f-proposal-number">Proposal #</label>
            <input
              id="f-proposal-number"
              maxLength={40}
              autoComplete="off"
              value={addForm.proposal_number}
              onChange={(e) => setAddForm((f) => ({ ...f, proposal_number: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="f-proposal-date">Proposal date</label>
            <input
              id="f-proposal-date"
              type="date"
              value={addForm.proposal_date}
              onChange={(e) => setAddForm((f) => ({ ...f, proposal_date: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="f-appointment-date">Appointment date</label>
            <input
              id="f-appointment-date"
              type="date"
              value={addForm.appointment_date}
              onChange={(e) => setAddForm((f) => ({ ...f, appointment_date: e.target.value }))}
            />
          </div>
          <div className={`${styles.field} ${styles["is-full"]}`}>
            <label htmlFor="f-jobsite">Jobsite address</label>
            <input
              id="f-jobsite"
              maxLength={200}
              autoComplete="off"
              value={addForm.jobsite_address}
              onChange={(e) => setAddForm((f) => ({ ...f, jobsite_address: e.target.value }))}
              onBlur={(e) => checkAddAddressMatch(e.target.value)}
            />
            {addMatchingAddress && <div className={styles["geocode-status"]}>Checking for a matching property…</div>}
            {!addMatchingAddress && addAddressMatches.length > 0 && (
              <div className={styles["bulk-match-bar"]}>
                <span>Matches an existing property on file:</span>
                <div className={styles["bulk-match-actions"]}>
                  {addAddressMatches.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      className={styles["bulk-match-btn"]}
                      onClick={() => applyAddMatchedAddress(match)}
                    >
                      {formatPropertyLabel(match)} ·{" "}
                      {match.distanceMeters < 1000 ? `${match.distanceMeters}m` : `${(match.distanceMeters / 1000).toFixed(1)}km`} away
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className={`${styles.field} ${styles["is-full"]}`}>
            <label htmlFor="f-next-action">Next action</label>
            <input
              id="f-next-action"
              maxLength={200}
              autoComplete="off"
              value={addForm.next_action}
              onChange={(e) => setAddForm((f) => ({ ...f, next_action: e.target.value }))}
            />
          </div>
          <div className={`${styles.field} ${styles["is-full"]}`}>
            <label htmlFor="f-proposal-description">Proposal description</label>
            <textarea
              id="f-proposal-description"
              rows={2}
              maxLength={2000}
              value={addForm.proposal_description}
              onChange={(e) => setAddForm((f) => ({ ...f, proposal_description: e.target.value }))}
            />
          </div>
          <div className={styles["add-actions"]}>
            <button type="button" className={styles["add-cancel"]} onClick={closeNewDealForm}>
              Cancel
            </button>
            <button type="submit" className={styles["add-submit"]} disabled={addSubmitting}>
              {addSubmitting ? "Creating…" : "Create deal"}
            </button>
          </div>
          {addError && <div className={styles["add-error"]}>{addError}</div>}
        </form>
      </div>

      <div className={styles["board-wrap"]}>
        <div className={styles.board}>
          {STAGES.map((stage) => {
            const stageDeals = activeDeals.filter((d) => d.stage === stage);
            const stageTotal = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0);
            const color = STAGE_COLORS[stage];
            const collapsed = !!columnCollapsedState[stage];
            const sortMode = columnSortState[stage] || "";

            if (collapsed) {
              return (
                <div
                  key={stage}
                  className={`${styles.column} ${styles["is-collapsed"]}`}
                  style={{ ["--col-color" as string]: color }}
                  data-column
                  data-stage={stage}
                >
                  <button
                    type="button"
                    className={styles["column-expand-btn"]}
                    aria-label={`Expand ${stage} (${stageDeals.length} deals)`}
                    onClick={() => setColumnCollapsedState((s) => ({ ...s, [stage]: false }))}
                  >
                    <span className={styles["column-dot"]} />
                    <span className={styles["column-count"]}>{stageDeals.length}</span>
                    <span className={styles["column-title-vertical"]}>{stage}</span>
                  </button>
                </div>
              );
            }

            return (
              <div
                key={stage}
                className={styles.column}
                style={{ ["--col-color" as string]: color }}
                data-column
                data-stage={stage}
              >
                <div className={styles["column-head"]}>
                  <button
                    type="button"
                    className={styles["column-collapse-btn"]}
                    aria-label={`Collapse ${stage}`}
                    onClick={() => setColumnCollapsedState((s) => ({ ...s, [stage]: true }))}
                  >
                    ‹
                  </button>
                  <span className={styles["column-dot"]} />
                  <span className={styles["column-title"]}>{stage}</span>
                  <div className={styles["column-sort-group"]}>
                    <button
                      type="button"
                      className={`${styles["column-sort-btn"]} ${sortMode.indexOf("value_") === 0 ? styles["is-active"] : ""}`}
                      aria-label={`Sort ${stage} by value`}
                      onClick={() =>
                        setColumnSortState((s) => ({ ...s, [stage]: nextValueSort(sortMode) }))
                      }
                    >
                      {"$" + (sortMode === "value_desc" ? "▾" : sortMode === "value_asc" ? "▴" : "")}
                    </button>
                    <button
                      type="button"
                      className={`${styles["column-sort-btn"]} ${sortMode.indexOf("alpha_") === 0 ? styles["is-active"] : ""}`}
                      aria-label={`Sort ${stage} alphabetically`}
                      onClick={() =>
                        setColumnSortState((s) => ({ ...s, [stage]: nextAlphaSort(sortMode) }))
                      }
                    >
                      {"A/Z" + (sortMode === "alpha_asc" ? "▴" : sortMode === "alpha_desc" ? "▾" : "")}
                    </button>
                  </div>
                  <span className={styles["column-count"]}>{stageDeals.length}</span>
                </div>
                <div className={styles["column-total"]}>{stageTotal > 0 ? currency.format(stageTotal) : "—"}</div>
                <div className={styles["column-body"]}>
                  {stageDeals.length === 0 ? (
                    <div className={styles["column-empty"]}>No deals</div>
                  ) : (
                    sortDeals(stageDeals, sortMode).map((deal) => (
                      <DealCard
                        key={deal.id}
                        deal={deal}
                        color={color}
                        showDescriptions={showDescriptions}
                        showNextAction={showNextAction}
                        onDragStart={handleDragStart}
                        onOpen={(d) => setActiveDealId(d.id)}
                        onLongPress={(d) => router.push(`/photos?deal=${d.id}`)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`${styles.toast} ${toast ? styles["is-visible"] : ""}`} role="status" aria-live="polite">
        <span>{toast}</span>
      </div>

      {activeDeal && (
        <DealModal
          key={activeDeal.id}
          deal={activeDeal}
          relatedDeals={relatedDeals}
          onSelectDeal={(id) => setActiveDealId(id)}
          onClose={() => setActiveDealId(null)}
          onSave={handleSaveDeal}
          onDelete={handleDeleteDeal}
          onToggleLost={handleToggleLost}
          onUploadPhoto={handleUploadPhoto}
          onDeletePhoto={handleDeletePhoto}
          onUploadProposalPdf={handleUploadProposalPdf}
          onDeleteProposalPdf={handleDeleteProposalPdf}
        />
      )}

      {lostModalOpen && (
        <LostModal deals={deals} onClose={() => setLostModalOpen(false)} onRestore={handleToggleLost} />
      )}
    </div>
  );
}
