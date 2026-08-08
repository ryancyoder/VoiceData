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

const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE = 10;

export default function DealCard({
  deal,
  color,
  showDescriptions,
  showNextAction,
  onDragStart,
  onOpen,
  onLongPress,
}: {
  deal: UiDeal;
  color: string;
  showDescriptions: boolean;
  showNextAction: boolean;
  onDragStart: (e: React.PointerEvent<HTMLSpanElement>, deal: UiDeal) => void;
  onOpen: (deal: UiDeal) => void;
  onLongPress: (deal: UiDeal) => void;
}) {
  const [pressing, setPressing] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);

  function clearLongPress() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pressStartRef.current = null;
    setPressing(false);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (deal._pending) return;
    longPressFiredRef.current = false;
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    setPressing(true);
    longPressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setPressing(false);
      onLongPress(deal);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = pressStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) clearLongPress();
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
      aria-label={`View details for ${deal.deal_name}`}
      onClick={() => {
        if (longPressFiredRef.current) {
          longPressFiredRef.current = false;
          return;
        }
        onOpen(deal);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(deal);
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
    >
      <div className={styles["card-top"]}>
        <span
          className={styles["card-handle"]}
          aria-hidden="true"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            if (deal._pending) return;
            e.stopPropagation();
            clearLongPress();
            onDragStart(e, deal);
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
        {deal.stage === "Proposal Sent" && flattenDealPhotos(deal).length > 0 && (
          <div className={styles["card-photo-badge"]} title="Has photos" aria-hidden="true">
            📷
          </div>
        )}
        {deal.stage === "Proposal Sent" && deal.proposal_pdf_path && (
          <div className={styles["card-doc-badge"]} title="Has proposal PDF" aria-hidden="true">
            📄
          </div>
        )}
      </div>

      {deal.stage === "Proposal Sent" && deal.proposal_date && (
        <div className={styles["card-proposal-date"]}>Sent {formatProposalDate(deal.proposal_date)}</div>
      )}

      {showNextAction && deal.next_action && (
        <div className={`${styles["card-desc"]} ${styles["card-next-action"]}`}>{"> " + deal.next_action}</div>
      )}

      {showDescriptions && deal.proposal_description && (
        <div className={styles["card-desc"]}>{deal.proposal_description}</div>
      )}

      {deal._error && <div className={styles["card-error"]}>{deal._error}</div>}

      {/* Only when the "Next Action" toggle is off — with it on, the same
          text is already showing inline above, so a hover copy would just
          be redundant. */}
      {!showNextAction && deal.next_action && <div className={styles["card-hover-tooltip"]}>{deal.next_action}</div>}
    </div>
  );
}
