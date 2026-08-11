"use client";

import { useState } from "react";
import styles from "./sales-board.module.css";
import type { Stage } from "@/lib/salesBoard";
import { STAGES } from "@/lib/salesBoard";
import type { UiDeal } from "./DealCard";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const STAGE_COLOR_VAR: Record<Stage, string> = {
  Lead: "var(--c-lead)",
  Propose: "var(--c-propose)",
  Sent: "var(--c-send)",
  Sold: "var(--c-sold)",
  "Project Management": "var(--c-pm)",
  Invoiced: "var(--c-invoiced)",
  "Paid in Full": "var(--c-paid)",
};

// A plain date ("YYYY-MM-DD") formatted as "Mar 5" — parsed from y/m/d parts
// so it never shifts a day in a negative-UTC timezone.
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function contactName(d: UiDeal): string {
  const c = d.property?.contact;
  if (!c) return "";
  return [c.first_name, c.last_name].filter(Boolean).join(" ");
}

function productionWindow(d: UiDeal): string {
  if (d.start_date && d.end_date && d.start_date !== d.end_date) return `${fmtDate(d.start_date)} – ${fmtDate(d.end_date)}`;
  if (d.start_date || d.end_date) return fmtDate(d.start_date || d.end_date);
  return "";
}

type Align = "left" | "right";
interface Column {
  key: string;
  label: string;
  align?: Align;
  // The value used for sorting (numbers sort numerically, strings A→Z; null
  // always sorts to the end regardless of direction).
  sortVal: (d: UiDeal) => string | number | null;
  render: (d: UiDeal) => React.ReactNode;
}

const COLUMNS: Column[] = [
  { key: "name", label: "Deal", sortVal: (d) => d.deal_name.toLowerCase(), render: (d) => <span className={styles["dt-name"]}>{d.deal_name}</span> },
  { key: "company", label: "Company", sortVal: (d) => d.company?.toLowerCase() ?? null, render: (d) => d.company ?? "" },
  {
    key: "stage",
    label: "Stage",
    sortVal: (d) => STAGES.indexOf(d.stage),
    render: (d) => (
      <span className={styles["dt-stage"]} style={{ ["--col-color" as string]: STAGE_COLOR_VAR[d.stage] }}>
        {d.stage}
      </span>
    ),
  },
  { key: "value", label: "Value", align: "right", sortVal: (d) => d.value ?? null, render: (d) => (d.value ? currency.format(d.value) : "") },
  { key: "contact", label: "Contact", sortVal: (d) => contactName(d).toLowerCase() || null, render: (d) => contactName(d) },
  { key: "jobsite", label: "Jobsite", sortVal: (d) => d.property?.address?.toLowerCase() ?? null, render: (d) => d.property?.address ?? "" },
  { key: "rfp_date", label: "RFP", sortVal: (d) => d.rfp_date ?? null, render: (d) => fmtDate(d.rfp_date) },
  { key: "appointment_date", label: "Appt", sortVal: (d) => d.appointment_date ?? null, render: (d) => fmtDate(d.appointment_date) },
  { key: "proposal_date", label: "Proposal", sortVal: (d) => d.proposal_date ?? null, render: (d) => fmtDate(d.proposal_date) },
  { key: "won_date", label: "Won", sortVal: (d) => d.won_date ?? null, render: (d) => fmtDate(d.won_date) },
  { key: "production", label: "Production", sortVal: (d) => d.start_date || d.end_date || null, render: (d) => productionWindow(d) },
  { key: "invoiced_date", label: "Invoiced", sortVal: (d) => d.invoiced_date ?? null, render: (d) => fmtDate(d.invoiced_date) },
  { key: "paid_date", label: "Paid", sortVal: (d) => d.paid_date ?? null, render: (d) => fmtDate(d.paid_date) },
  { key: "next_action", label: "Next action", sortVal: (d) => d.next_action?.toLowerCase() ?? null, render: (d) => d.next_action ?? "" },
];

export default function DealTable({ deals, onOpen }: { deals: UiDeal[]; onOpen: (deal: UiDeal) => void }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  function toggleSort(key: string) {
    if (sortKey === key) {
      // asc → desc → off
      if (sortDir === 1) setSortDir(-1);
      else {
        setSortKey(null);
        setSortDir(1);
      }
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  const activeCol = sortKey ? COLUMNS.find((c) => c.key === sortKey) ?? null : null;
  const rows = activeCol
    ? [...deals].sort((a, b) => {
        const va = activeCol.sortVal(a);
        const vb = activeCol.sortVal(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === "number" && typeof vb === "number") return sortDir * (va - vb);
        return sortDir * String(va).localeCompare(String(vb));
      })
    : deals;

  return (
    <div className={styles["table-wrap"]}>
      <table className={styles["deal-table"]}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={col.align === "right" ? styles["dt-right"] : undefined}
                aria-sort={sortKey === col.key ? (sortDir === 1 ? "ascending" : "descending") : "none"}
              >
                <button type="button" className={styles["dt-sort"]} onClick={() => toggleSort(col.key)}>
                  {col.label}
                  <span className={styles["dt-arrow"]}>{sortKey === col.key ? (sortDir === 1 ? "▴" : "▾") : ""}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className={styles["dt-empty"]}>
                No deals
              </td>
            </tr>
          ) : (
            rows.map((d) => (
              <tr key={d.id} className={styles["dt-row"]} onClick={() => onOpen(d)} tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(d);
                  }
                }}
              >
                {COLUMNS.map((col) => (
                  <td key={col.key} className={col.align === "right" ? styles["dt-right"] : undefined}>
                    {col.render(d)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
