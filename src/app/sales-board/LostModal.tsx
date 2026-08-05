"use client";

import { useEffect, useState } from "react";
import styles from "./sales-board.module.css";
import type { Deal } from "@/lib/salesBoard";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function formatDateTime(isoStr: string) {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function LostModal({
  deals,
  onClose,
  onRestore,
}: {
  deals: Deal[];
  onClose: () => void;
  onRestore: (deal: Deal) => Promise<void>;
}) {
  const [restoringId, setRestoringId] = useState<number | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const lost = deals
    .filter((d) => d.lost_at)
    .sort((a, b) => new Date(b.lost_at as string).getTime() - new Date(a.lost_at as string).getTime());

  return (
    <div
      className={styles["modal-overlay"]}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles["modal-panel"]} role="dialog" aria-modal="true">
        <div className={styles["modal-head"]}>
          <h2 className={styles["modal-title"]}>Lost deals</h2>
          <button type="button" className={styles["modal-close"]} aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className={styles["lost-list"]}>
          {lost.length === 0 && <div className={styles["lost-empty"]}>No lost deals.</div>}
          {lost.map((deal) => (
            <div key={deal.id} className={styles["lost-item"]}>
              <div className={styles["lost-item-main"]}>
                <div className={styles["lost-item-name"]}>{deal.deal_name}</div>
                <div className={styles["lost-item-meta"]}>
                  {[
                    `Was in ${deal.stage}`,
                    deal.value ? currency.format(deal.value) : null,
                    `Lost ${formatDateTime(deal.lost_at as string)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <button
                type="button"
                className={styles["lost-item-restore"]}
                disabled={restoringId === deal.id}
                onClick={async () => {
                  setRestoringId(deal.id);
                  try {
                    await onRestore(deal);
                  } finally {
                    setRestoringId(null);
                  }
                }}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
