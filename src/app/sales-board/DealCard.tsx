"use client";

import styles from "./sales-board.module.css";
import type { Deal } from "@/lib/salesBoard";

export type UiDeal = Deal & { _pending?: boolean; _error?: string };

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function DealCard({
  deal,
  color,
  showDescriptions,
  showNextAction,
  onDragStart,
  onOpen,
}: {
  deal: UiDeal;
  color: string;
  showDescriptions: boolean;
  showNextAction: boolean;
  onDragStart: (e: React.PointerEvent<HTMLSpanElement>, deal: UiDeal) => void;
  onOpen: (deal: UiDeal) => void;
}) {
  return (
    <div
      className={[
        styles.card,
        deal._pending ? styles["is-pending"] : "",
        deal._error ? styles["is-error"] : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--col-color" as string]: color }}
      data-card
      data-id={deal.id}
      tabIndex={0}
      role="button"
      aria-label={`View details for ${deal.deal_name}`}
      onClick={() => onOpen(deal)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(deal);
        }
      }}
    >
      <div className={styles["card-top"]}>
        <span
          className={styles["card-handle"]}
          aria-hidden="true"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            if (deal._pending) return;
            e.stopPropagation();
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
      </div>

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
