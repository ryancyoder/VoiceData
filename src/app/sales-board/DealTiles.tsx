"use client";

import { useRef, useState } from "react";
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

function contactName(d: UiDeal): string {
  const c = d.property?.contact;
  if (!c) return "";
  return [c.first_name, c.last_name].filter(Boolean).join(" ");
}

// A short two-letter monogram for the photo-less placeholder — the deal name's
// first two initials, falling back to its first two characters.
function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

type SortKey = "name" | "value" | "stage";

// Long-press (hold without moving) opens the property's photo album; a normal
// tap opens the deal. Fired on the hold threshold so it feels like an iOS
// press-and-hold, and the release click is then suppressed.
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

export default function DealTiles({
  deals,
  coverUrls,
  onOpen,
  onOpenAlbum,
}: {
  deals: UiDeal[];
  // property id -> cover photo URL. Missing entries just mean no photo yet.
  coverUrls: Record<number, string>;
  onOpen: (deal: UiDeal) => void;
  // Long-press action — open this deal's property photo album.
  onOpenAlbum: (deal: UiDeal) => void;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("stage");
  // Empty set = every stage shown. Otherwise only the selected stages.
  const [stageFilter, setStageFilter] = useState<Set<Stage>>(new Set());

  // One press at a time, so a single set of refs covers the whole grid.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  function clearPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressStart.current = null;
  }

  function startPress(deal: UiDeal, e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    longPressFired.current = false;
    clearPress();
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      longPressFired.current = true;
      onOpenAlbum(deal);
    }, LONG_PRESS_MS);
  }

  function movePress(e: React.PointerEvent) {
    const start = pressStart.current;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) clearPress();
  }

  function handleClick(deal: UiDeal) {
    // A completed long-press already navigated — swallow the release click so
    // it doesn't also open the deal modal.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    onOpen(deal);
  }

  function toggleStage(stage: Stage) {
    setStageFilter((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const filtered = deals.filter((d) => {
    if (stageFilter.size > 0 && !stageFilter.has(d.stage)) return false;
    if (!q) return true;
    return (
      d.deal_name.toLowerCase().includes(q) ||
      contactName(d).toLowerCase().includes(q) ||
      (d.property?.address ?? "").toLowerCase().includes(q) ||
      (d.proposal_description ?? "").toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "value") return (b.value ?? 0) - (a.value ?? 0);
    if (sortKey === "name") return a.deal_name.toLowerCase().localeCompare(b.deal_name.toLowerCase());
    // stage: pipeline order, then value within a stage (biggest first).
    const s = STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage);
    return s !== 0 ? s : (b.value ?? 0) - (a.value ?? 0);
  });

  return (
    <div className={styles["table-wrap"]}>
      <div className={styles["dt-toolbar"]}>
        <input
          type="search"
          className={styles["dt-search"]}
          placeholder="Filter deals…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className={styles["dt-count"]}>{sorted.length} of {deals.length}</span>
        <div className={styles["tile-sort"]} role="group" aria-label="Sort tiles">
          {(["stage", "value", "name"] as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={sortKey === key ? styles["is-active"] : ""}
              onClick={() => setSortKey(key)}
            >
              {key === "stage" ? "Stage" : key === "value" ? "Value" : "A–Z"}
            </button>
          ))}
        </div>
      </div>
      <div className={styles["dt-filterbar"]} role="group" aria-label="Filter by stage">
        <button
          type="button"
          className={`${styles["dt-chip"]} ${stageFilter.size === 0 ? styles["is-active"] : ""}`}
          onClick={() => setStageFilter(new Set())}
        >
          All
        </button>
        {STAGES.map((stage) => {
          const active = stageFilter.has(stage);
          return (
            <button
              key={stage}
              type="button"
              aria-pressed={active}
              className={`${styles["dt-chip"]} ${active ? styles["is-active"] : ""}`}
              style={{ ["--col-color" as string]: STAGE_COLOR_VAR[stage] }}
              onClick={() => toggleStage(stage)}
            >
              {stage}
            </button>
          );
        })}
      </div>

      <div className={styles["table-scroll"]}>
        {sorted.length === 0 ? (
          <div className={styles["dt-empty"]}>No deals</div>
        ) : (
          <div className={styles["tile-grid"]}>
            {sorted.map((d) => {
              const cover = d.property_id != null ? coverUrls[d.property_id] ?? null : null;
              const color = STAGE_COLOR_VAR[d.stage];
              const contact = contactName(d);
              return (
                <button
                  key={d.id}
                  type="button"
                  className={styles["tile"]}
                  style={{ ["--col-color" as string]: color }}
                  onClick={() => handleClick(d)}
                  onPointerDown={(e) => startPress(d, e)}
                  onPointerMove={movePress}
                  onPointerUp={clearPress}
                  onPointerLeave={clearPress}
                  onPointerCancel={clearPress}
                  onContextMenu={(e) => e.preventDefault()}
                  title={`${d.deal_name} — tap to open, hold for photos`}
                >
                  <div className={styles["tile-photo"]}>
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" loading="lazy" draggable={false} />
                    ) : (
                      <span className={styles["tile-photo-empty"]} aria-hidden="true">
                        {monogram(d.deal_name)}
                      </span>
                    )}
                    <span className={styles["tile-stage"]}>{d.stage}</span>
                    {d.flagged && (
                      <span className={styles["tile-flag"]} title="Flagged — loose end to tie up">
                        🚩
                      </span>
                    )}
                    {!!d.value && <span className={styles["tile-value"]}>{currency.format(d.value)}</span>}
                  </div>
                  <div className={styles["tile-body"]}>
                    <div className={styles["tile-name"]}>{d.deal_name}</div>
                    {contact && <div className={styles["tile-contact"]}>{contact}</div>}
                    {d.property?.address && <div className={styles["tile-address"]}>{d.property.address}</div>}
                    {d.next_action && <div className={styles["tile-next"]}>{"› " + d.next_action}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
