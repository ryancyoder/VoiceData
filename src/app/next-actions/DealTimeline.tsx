"use client";

import Link from "next/link";
import { MILESTONE_EVENT_TYPES, type EventType, type MilestoneEventType } from "@/lib/events";
import styles from "./next-actions.module.css";

// The deal timeline's milestones are a fixed, dedicated list — entirely
// decoupled from the Sales Board's real pipeline (Stage/STAGES). A
// milestone is "reached" purely by a matching calendar event existing for
// the deal (see PATCH /api/sales-board/[id], which creates one of these
// automatically for the stage transitions that matter), never by the
// deal's current pipeline stage.
const TIMELINE_MILESTONES: { type: MilestoneEventType; icon: string }[] = [
  { type: "Proposal Sent", icon: "📤" },
  { type: "Sold", icon: "🤝" },
  { type: "Project Management", icon: "🚧" },
  { type: "Invoiced", icon: "🧾" },
  { type: "Paid in Full", icon: "💰" },
];

const MILESTONE_EVENT_TYPE_SET = new Set<string>(MILESTONE_EVENT_TYPES);

// Mirrors the CSS: .timeline-icon is 34px, and .timeline-lead/.timeline-slot
// are each a fixed 115px (34px icon + 81px trailing space) — kept in sync
// here so the connecting line's JS-computed position lines up with the
// milestone icons' CSS-driven one. This fixed slot width is exactly what
// keeps milestones a constant distance apart regardless of how many
// non-milestone events land in the slot alongside them.
const SLOT_WIDTH = 115;
const ICON_CENTER = 17;

// Calendar event types that get their own icon instead of a plain dot.
const EVENT_ICONS: Partial<Record<EventType, string>> = {
  Appointment: "🏠",
};

export interface TimelineEvent {
  id: number;
  name: string | null;
  start_time: string;
  event_type: EventType | null;
}

type TimelineNode =
  | { kind: "milestone"; key: string; type: MilestoneEventType; icon: string; date: string | null; href: string | null; fulfilled: boolean }
  | { kind: "event"; key: string; icon: string | null; date: string; href: string; title: string };

function formatNodeDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DealTimeline({ events }: { events: TimelineEvent[] }) {
  // A stage change auto-creates a calendar event whose event_type is the
  // milestone it represents — that event IS the milestone's date/link/
  // fulfillment, so no separate stage-history data is needed. When a deal
  // passed through the same milestone more than once, the earliest event
  // wins.
  const earliestMilestoneEvent = new Map<string, TimelineEvent>();
  for (const event of events) {
    if (!event.event_type || !MILESTONE_EVENT_TYPE_SET.has(event.event_type)) continue;
    const existing = earliestMilestoneEvent.get(event.event_type);
    if (!existing || new Date(event.start_time).getTime() < new Date(existing.start_time).getTime()) {
      earliestMilestoneEvent.set(event.event_type, event);
    }
  }

  // Milestones always render in fixed order — never reordered or
  // displaced by event dates. Each remaining calendar event is slotted
  // into the gap right after whichever milestone's date is the closest
  // one on-or-before the event's own date (skipping over any undated
  // milestones in between), or before the very first milestone if none
  // qualify.
  const milestoneNodes: (TimelineNode & { kind: "milestone" })[] = TIMELINE_MILESTONES.map(({ type, icon }) => {
    const fulfillingEvent = earliestMilestoneEvent.get(type);
    return {
      kind: "milestone",
      key: `milestone-${type}`,
      type,
      icon,
      date: fulfillingEvent?.start_time ?? null,
      href: fulfillingEvent ? `/calendar?event=${fulfillingEvent.id}` : null,
      fulfilled: !!fulfillingEvent,
    };
  });

  const eventNodes: (TimelineNode & { kind: "event" })[] = events
    // Milestone-fulfilling events already render as their milestone node
    // above — showing them again as a floating dot would duplicate them.
    .filter((event) => !event.event_type || !MILESTONE_EVENT_TYPE_SET.has(event.event_type))
    .map((event) => ({
      kind: "event" as const,
      key: `event-${event.id}`,
      icon: event.event_type ? (EVENT_ICONS[event.event_type] ?? null) : null,
      date: event.start_time,
      href: `/calendar?event=${event.id}`,
      title: event.name || event.event_type || "Event",
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // eventsAfter[i] holds every event whose slot is right after milestone i;
  // eventsBefore holds ones that predate every dated milestone.
  const eventsAfter: (TimelineNode & { kind: "event" })[][] = milestoneNodes.map(() => []);
  const eventsBefore: (TimelineNode & { kind: "event" })[] = [];

  for (const event of eventNodes) {
    const eventTime = new Date(event.date).getTime();
    let slot = -1;
    for (let i = 0; i < milestoneNodes.length; i++) {
      const milestoneDate = milestoneNodes[i].date;
      if (milestoneDate && new Date(milestoneDate).getTime() <= eventTime) slot = i;
    }
    (slot === -1 ? eventsBefore : eventsAfter[slot]).push(event);
  }

  function renderEventNode(node: TimelineNode & { kind: "event" }) {
    return (
      <Link key={node.key} href={node.href} className={styles["timeline-node"]} title={`${node.title} — ${formatNodeDate(node.date)}`}>
        {node.icon ? (
          <span className={`${styles["timeline-icon"]} ${styles["is-fulfilled"]}`}>{node.icon}</span>
        ) : (
          <span className={styles["timeline-dot"]} />
        )}
        <span className={styles["timeline-date"]}>{formatNodeDate(node.date)}</span>
      </Link>
    );
  }

  function renderMilestoneNode(node: TimelineNode & { kind: "milestone" }) {
    const milestoneTitle = `${node.type}${node.date ? ` — ${formatNodeDate(node.date)}` : " — not yet reached"}`;
    const milestoneIcon = (
      <span className={`${styles["timeline-icon"]} ${node.fulfilled ? styles["is-fulfilled"] : styles["is-pending"]}`}>
        {node.icon}
      </span>
    );
    const milestoneDate = node.date && <span className={styles["timeline-date"]}>{formatNodeDate(node.date)}</span>;
    return node.href ? (
      <Link key={node.key} href={node.href} className={styles["timeline-node"]} title={milestoneTitle}>
        {milestoneIcon}
        {milestoneDate}
      </Link>
    ) : (
      <div key={node.key} className={styles["timeline-node"]} title={milestoneTitle}>
        {milestoneIcon}
        {milestoneDate}
      </div>
    );
  }

  return (
    <div className={styles.timeline}>
      <div
        className={styles["timeline-line"]}
        style={{ left: SLOT_WIDTH + ICON_CENTER, width: (milestoneNodes.length - 1) * SLOT_WIDTH }}
      />
      {/* A fixed-width lead-in slot for events that predate every dated
          milestone — always reserved, even when empty, so milestone 0's
          position never shifts based on whether any exist. */}
      <div className={styles["timeline-lead"]}>{eventsBefore.map(renderEventNode)}</div>
      {milestoneNodes.map((milestone, i) => (
        <div key={milestone.key} className={styles["timeline-slot"]}>
          {renderMilestoneNode(milestone)}
          {eventsAfter[i].map(renderEventNode)}
        </div>
      ))}
    </div>
  );
}
