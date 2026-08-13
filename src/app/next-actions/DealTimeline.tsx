"use client";

import styles from "./next-actions.module.css";

// The deal timeline is a fixed, date-driven lifecycle: each milestone's date
// comes straight from the deal's own per-stage date columns (see the Sales
// Board "Key dates"), not from calendar events. A milestone with no date shows
// as "not yet reached".
export interface TimelineDates {
  appointment: string | null; // Propose — appointment date
  proposal: string | null; // Sent — proposal date
  won: string | null; // Sold — won date
  production: string | null; // Project Management — production start date
  invoiced: string | null; // Invoiced date
  paid: string | null; // Paid in Full date
}

export type MilestoneKey = keyof TimelineDates;

export const MILESTONES: { key: MilestoneKey; label: string; icon: string }[] = [
  { key: "appointment", label: "Appointment", icon: "🏠" },
  { key: "proposal", label: "Proposal Sent", icon: "📤" },
  { key: "won", label: "Sold", icon: "🤝" },
  { key: "production", label: "Production", icon: "🚧" },
  { key: "invoiced", label: "Invoiced", icon: "🧾" },
  { key: "paid", label: "Paid in Full", icon: "💰" },
];

const SLOT_WIDTH = 128;
const ICON_CENTER = 17;

// A date-only 'YYYY-MM-DD' formatted without the UTC shift a bare `new
// Date(iso)` would introduce in a negative-offset timezone.
function formatDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A header row of per-milestone sort buttons, laid out with the same fixed
// slots as the timeline so each button sits directly above its milestone icon.
export function TimelineSortHeader({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: MilestoneKey | null;
  sortDir: "asc" | "desc";
  onSort: (key: MilestoneKey) => void;
}) {
  return (
    <div className={styles.timeline}>
      {MILESTONES.map((m) => {
        const active = sortKey === m.key;
        return (
          <div key={m.key} className={styles["timeline-msSlot"]}>
            <button
              type="button"
              className={`${styles["timeline-sort-btn"]} ${active ? styles["is-active"] : ""}`}
              onClick={() => onSort(m.key)}
              title={`Sort by ${m.label}${active ? (sortDir === "asc" ? " (earliest first)" : " (latest first)") : ""}`}
              aria-label={`Sort by ${m.label}`}
            >
              <span className={styles["timeline-sort-icon"]}>{m.icon}</span>
              <span className={styles["timeline-sort-caret"]}>{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function DealTimeline({ dates }: { dates: TimelineDates }) {
  return (
    <div className={styles.timeline}>
      <div
        className={styles["timeline-line"]}
        style={{ left: ICON_CENTER, width: (MILESTONES.length - 1) * SLOT_WIDTH }}
      />
      {MILESTONES.map((m) => {
        const date = dates[m.key];
        const fulfilled = !!date;
        return (
          <div key={m.key} className={styles["timeline-msSlot"]}>
            <div
              className={styles["timeline-node"]}
              title={`${m.label}${date ? ` — ${formatDate(date)}` : " — not yet reached"}`}
            >
              <span className={`${styles["timeline-icon"]} ${fulfilled ? styles["is-fulfilled"] : styles["is-pending"]}`}>
                {m.icon}
              </span>
              {date && <span className={styles["timeline-date"]}>{formatDate(date)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
