"use client";

import { useRef, useState } from "react";
import styles from "./sales-board.module.css";
import { flattenDealPhotos, type Deal } from "@/lib/salesBoard";

export type UiDeal = Deal & { _pending?: boolean; _error?: string };

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// A stored plain date ("YYYY-MM-DD") as a minimalist "MM/DD". Built from the
// y/m/d parts directly (no Date parsing) so it never shifts a day in a
// negative-UTC timezone.
function formatProposalDate(isoDate: string) {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}

// The deal's all-day work window as a compact "03/03–03/07" range. A single
// day (or only a start set) collapses to just that one date.
function formatDateWindow(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (start && end && start !== end) return `${formatProposalDate(start)}–${formatProposalDate(end)}`;
  return formatProposalDate((start || end) as string);
}

// Finger: hold this long (without moving) to grab a card — leaves quick swipes
// free to scroll the column. Pen/mouse: no wait — grab as soon as the pointer
// moves past DRAG_THRESHOLD, so an Apple Pencil just grabs and drags. A quick
// tap opens the deal; a double tap jumps to the deal's photo albums.
const DRAG_HOLD_MS = 450;
const MOVE_TOLERANCE = 10;
const DRAG_THRESHOLD = 6;
const DOUBLE_TAP_MS = 300;
// Pen/mouse: hold still this long (no drag) to arm opening the deal's Aspire
// opportunity link. The link opens on release — a real user gesture, so the
// browser won't block the new tab. Any drag past DRAG_THRESHOLD cancels it.
const LONG_PRESS_MS = 550;

export default function DealCard({
  deal,
  color,
  showDescriptions,
  showNextAction,
  onDragActivate,
  onOpen,
  onAlbums,
}: {
  deal: UiDeal;
  color: string;
  showDescriptions: boolean;
  showNextAction: boolean;
  // Start dragging the given card element with the active pointer.
  onDragActivate: (card: HTMLElement, pointerId: number, clientX: number, clientY: number, deal: UiDeal) => void;
  onOpen: (deal: UiDeal) => void;
  onAlbums: (deal: UiDeal) => void;
}) {
  const [pressing, setPressing] = useState(false);
  const [linkArmed, setLinkArmed] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressReadyRef = useRef(false);
  const pointerRef = useRef<{ id: number; x: number; y: number; el: HTMLElement; touch: boolean } | null>(null);
  const draggingRef = useRef(false);
  const lastTapRef = useRef(0);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHold() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setPressing(false);
  }

  function clearLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressReadyRef.current = false;
    setLinkArmed(false);
  }

  function openOpportunityLink() {
    if (deal.opportunity_link) window.open(deal.opportunity_link, "_blank", "noopener,noreferrer");
  }

  function startDrag(p: { id: number; x: number; y: number; el: HTMLElement }) {
    clearHold();
    clearLongPress();
    draggingRef.current = true;
    // Suppress native scrolling for the rest of a finger drag too (pen/mouse
    // were already suppressed on hover/down).
    p.el.style.touchAction = "none";
    onDragActivate(p.el, p.id, p.x, p.y, deal);
  }

  // Apple Pencil (and a mouse) hover over a card before pressing. Pre-arming
  // touch-action:none on hover means a grab gesture — even a vertical one —
  // starts without the column trying to scroll and stealing the drag. A finger
  // never hovers, so it keeps native scrolling.
  function handlePointerEnter(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "touch") (e.currentTarget as HTMLElement).style.touchAction = "none";
  }
  function handlePointerLeave(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current && !pointerRef.current) (e.currentTarget as HTMLElement).style.touchAction = "";
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (deal._pending) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const touch = e.pointerType === "touch";
    // Pen/mouse never scrolls the column — kill native panning up front so a
    // vertical grab drags instead of scrolling.
    if (!touch) el.style.touchAction = "none";
    draggingRef.current = false;
    longPressReadyRef.current = false;
    setLinkArmed(false);
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, el, touch };
    setPressing(true);
    // Finger: arm the hold-to-grab timer. Pen/mouse: nothing here — the grab
    // fires on movement in handlePointerMove instead.
    if (touch) {
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        const p = pointerRef.current;
        if (p) startDrag(p);
      }, DRAG_HOLD_MS);
    } else if (deal.opportunity_link) {
      // Pen/mouse: holding still (no drag) arms opening the opportunity link on
      // release. Movement past the drag threshold cancels it in handlePointerMove.
      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        if (!draggingRef.current) {
          longPressReadyRef.current = true;
          setLinkArmed(true);
        }
      }, LONG_PRESS_MS);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointerRef.current;
    if (!p || e.pointerId !== p.id || draggingRef.current) return;
    const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (p.touch) {
      // Finger moved before the hold completed — it's a scroll, not a grab.
      if (dist > MOVE_TOLERANCE) {
        clearHold();
        pointerRef.current = null;
      }
    } else if (dist > DRAG_THRESHOLD) {
      // Pen/mouse crossed the drag threshold — grab immediately.
      startDrag(p);
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    clearHold();
    const armed = longPressReadyRef.current;
    clearLongPress();
    const p = pointerRef.current;
    // A finger interaction restores native scrolling on release (pen/mouse keep
    // it suppressed while hovering; pointerleave clears it when they leave).
    if (p?.touch) p.el.style.touchAction = "";
    if (draggingRef.current) {
      draggingRef.current = false;
      pointerRef.current = null;
      return;
    }
    // Long press completed without dragging — open the opportunity link and
    // suppress the tap-to-open that a release would otherwise trigger.
    if (armed) {
      pointerRef.current = null;
      lastTapRef.current = 0;
      openOpportunityLink();
      return;
    }
    pointerRef.current = null;
    if (!p || e.pointerId !== p.id) return;
    // A tap. Distinguish single (open deal) from double (albums).
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      onAlbums(deal);
    } else {
      lastTapRef.current = now;
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        lastTapRef.current = 0;
        onOpen(deal);
      }, DOUBLE_TAP_MS);
    }
  }

  function handlePointerCancel() {
    clearHold();
    clearLongPress();
    const p = pointerRef.current;
    if (p?.touch) p.el.style.touchAction = "";
    draggingRef.current = false;
    pointerRef.current = null;
  }

  return (
    <div
      className={[
        styles.card,
        deal._pending ? styles["is-pending"] : "",
        deal._error ? styles["is-error"] : "",
        pressing ? styles["is-pressing"] : "",
        linkArmed ? styles["is-link-armed"] : "",
        deal.opportunity_link ? styles["is-linked"] : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--col-color" as string]: color }}
      data-card
      data-id={deal.id}
      tabIndex={0}
      role="button"
      aria-label={`${deal.deal_name} — tap to open, double-tap for photos, hold to move${
        deal.opportunity_link ? ", long-press to open opportunity link" : ""
      }`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(deal);
        }
      }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className={styles["card-top"]}>
        <div className={styles["card-name"]}>{deal.deal_name}</div>
        {!!deal.value && <div className={styles["card-value"]}>{currency.format(deal.value)}</div>}
        {deal.stage === "Propose" && flattenDealPhotos(deal).length > 0 && (
          <div className={styles["card-photo-badge"]} aria-hidden="true">
            📷
          </div>
        )}
        {deal.stage === "Sent" && deal.proposal_pdf_path && (
          <div className={styles["card-doc-badge"]} aria-hidden="true">
            📄
          </div>
        )}
      </div>

      {deal.stage === "Propose" && deal.appointment_date && (
        <div className={styles["card-proposal-date"]}>Appt {formatProposalDate(deal.appointment_date)}</div>
      )}

      {deal.stage === "Sent" && deal.proposal_date && (
        <div className={styles["card-proposal-date"]}>Sent {formatProposalDate(deal.proposal_date)}</div>
      )}

      {formatDateWindow(deal.start_date, deal.end_date) && (
        <div className={styles["card-schedule-date"]}>Prod {formatDateWindow(deal.start_date, deal.end_date)}</div>
      )}

      {showNextAction && deal.next_action && (
        <div className={`${styles["card-desc"]} ${styles["card-next-action"]}`}>{"> " + deal.next_action}</div>
      )}

      {showDescriptions && deal.proposal_description && (
        <div className={styles["card-desc"]}>{deal.proposal_description}</div>
      )}

      {deal._error && <div className={styles["card-error"]}>{deal._error}</div>}
    </div>
  );
}
