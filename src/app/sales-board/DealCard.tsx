"use client";

import { useRef, useState } from "react";
import styles from "./sales-board.module.css";
import { flattenDealPhotos, type Deal } from "@/lib/salesBoard";

export type UiDeal = Deal & { _pending?: boolean; _error?: string };

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// proposal_date is a plain date (no time component) — parsing it with
// `new Date(isoDate)` reads it as UTC midnight, which prints as the
// previous day in a negative-UTC-offset timezone. Parsing the y/m/d parts
// directly keeps it the literal date that was stored.
function formatProposalDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// The deal's all-day work window as a compact "Mar 3 – Mar 7" range. A single
// day (or only a start set) collapses to just that one date.
function formatDateWindow(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (start && end && start !== end) return `${formatProposalDate(start)} – ${formatProposalDate(end)}`;
  return formatProposalDate((start || end) as string);
}

// Hold this long (without moving) to grab the card for dragging. A quick tap
// opens the deal; a double tap jumps to the deal's photo albums.
const DRAG_HOLD_MS = 450;
const MOVE_TOLERANCE = 10;
const DOUBLE_TAP_MS = 300;

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
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRef = useRef<{ id: number; x: number; y: number; el: HTMLElement } | null>(null);
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

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (deal._pending) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    draggingRef.current = false;
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, el };
    setPressing(true);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      const p = pointerRef.current;
      if (!p) return;
      setPressing(false);
      draggingRef.current = true;
      onDragActivate(p.el, p.id, p.x, p.y, deal);
    }, DRAG_HOLD_MS);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointerRef.current;
    if (!p || e.pointerId !== p.id || draggingRef.current) return;
    // Moved before the hold completed — treat as a scroll, not a hold or tap.
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) {
      clearHold();
      pointerRef.current = null;
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    clearHold();
    if (draggingRef.current) {
      draggingRef.current = false;
      pointerRef.current = null;
      return;
    }
    const p = pointerRef.current;
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
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--col-color" as string]: color }}
      data-card
      data-id={deal.id}
      tabIndex={0}
      role="button"
      aria-label={`${deal.deal_name} — tap to open, double-tap for photos, hold to move`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(deal);
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className={styles["card-top"]}>
        <span
          className={styles["card-handle"]}
          aria-hidden="true"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            if (deal._pending) return;
            e.stopPropagation();
            e.preventDefault();
            clearHold();
            const card = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-card]");
            if (card) onDragActivate(card, e.pointerId, e.clientX, e.clientY, deal);
          }}
        >
          <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor">
            <circle cx="3" cy="2" r="1.3" />
            <circle cx="7" cy="2" r="1.3" />
            <circle cx="3" cy="8" r="1.3" />
            <circle cx="7" cy="8" r="1.3" />
            <circle cx="3" cy="14" r="1.3" />
            <circle cx="7" cy="14" r="1.3" />
          </svg>
        </span>
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
        <div className={styles["card-proposal-date"]}>📅 Appt {formatProposalDate(deal.appointment_date)}</div>
      )}

      {deal.stage === "Sent" && deal.proposal_date && (
        <div className={styles["card-proposal-date"]}>Sent {formatProposalDate(deal.proposal_date)}</div>
      )}

      {formatDateWindow(deal.start_date, deal.end_date) && (
        <div className={styles["card-schedule-date"]}>🗓 Production {formatDateWindow(deal.start_date, deal.end_date)}</div>
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
