"use client";

import Link from "next/link";
import { STAGES, type Stage } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";
import styles from "./next-actions.module.css";

// A dedicated, timeline-only list of milestones — deliberately separate
// from the Sales Board's STAGES array (which drives the actual pipeline
// columns), so this list's icons/membership can be trimmed or extended
// later without touching the pipeline itself. Currently a 1:1 mirror of
// STAGES.
const TIMELINE_STAGES: { stage: Stage; icon: string }[] = [
  { stage: "Proposal Sent", icon: "📤" },
  { stage: "Sold", icon: "🤝" },
  { stage: "Project Management", icon: "🚧" },
  { stage: "Invoiced", icon: "🧾" },
  { stage: "Paid in Full", icon: "💰" },
];

// Every stage in TIMELINE_STAGES doubles as a calendar event_type — moving
// a deal to that stage auto-creates a matching event (see PATCH
// /api/sales-board/[id]), which is how a milestone's date gets filled in.
const MILESTONE_EVENT_TYPES = new Set<string>(TIMELINE_STAGES.map((m) => m.stage));

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
  | { kind: "stage"; key: string; stage: Stage; icon: string; date: string | null; href: string | null; fulfilled: boolean }
  | { kind: "event"; key: string; icon: string | null; date: string; href: string; title: string };

function formatNodeDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DealTimeline({
  currentStage,
  events,
}: {
  currentStage: Stage;
  events: TimelineEvent[];
}) {
  const currentIndex = STAGES.indexOf(currentStage);

  // A stage change auto-creates a calendar event whose event_type is the
  // new stage (see PATCH /api/sales-board/[id]) — that event IS the
  // milestone's date/link, so no separate stage-history data is needed.
  // When a deal passed through the same stage more than once, the
  // earliest event wins.
  const earliestMilestoneEvent = new Map<string, TimelineEvent>();
  for (const event of events) {
    if (!event.event_type || !MILESTONE_EVENT_TYPES.has(event.event_type)) continue;
    const existing = earliestMilestoneEvent.get(event.event_type);
    if (!existing || new Date(event.start_time).getTime() < new Date(existing.start_time).getTime()) {
      earliestMilestoneEvent.set(event.event_type, event);
    }
  }

  // Milestones always render in fixed pipeline order — never reordered or
  // displaced by event dates. Each remaining calendar event is slotted
  // into the gap right after whichever milestone's date is the closest
  // one on-or-before the event's own date (skipping over any undated
  // milestones in between), or before the very first milestone if none
  // qualify.
  const milestoneNodes: (TimelineNode & { kind: "stage" })[] = TIMELINE_STAGES.map(({ stage, icon }) => {
    const fulfillingEvent = earliestMilestoneEvent.get(stage);
    return {
      kind: "stage",
      key: `stage-${stage}`,
      stage,
      icon,
      date: fulfillingEvent?.start_time ?? null,
      href: fulfillingEvent ? `/calendar?event=${fulfillingEvent.id}` : null,
      fulfilled: STAGES.indexOf(stage) <= currentIndex,
    };
  });

  const eventNodes: (TimelineNode & { kind: "event" })[] = events
    // Milestone-fulfilling events already render as their stage's node
    // above — showing them again as a floating dot would duplicate them.
    .filter((event) => !event.event_type || !MILESTONE_EVENT_TYPES.has(event.event_type))
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
  const eventsAfter: TimelineNode[][] = milestoneNodes.map(() => []);
  const eventsBefore: TimelineNode[] = [];

  for (const event of eventNodes) {
    const eventTime = new Date(event.date).getTime();
    let slot = -1;
    for (let i = 0; i < milestoneNodes.length; i++) {
      const milestoneDate = milestoneNodes[i].date;
      if (milestoneDate && new Date(milestoneDate).getTime() <= eventTime) slot = i;
    }
    (slot === -1 ? eventsBefore : eventsAfter[slot]).push(event);
  }

  const nodes: TimelineNode[] = [...eventsBefore];
  milestoneNodes.forEach((milestone, i) => {
    nodes.push(milestone, ...eventsAfter[i]);
  });

  return (
    <div className={styles.timeline}>
      {nodes.map((node) => {
        if (node.kind === "stage") {
          const stageTitle = `${node.stage}${node.date ? ` — ${formatNodeDate(node.date)}` : node.fulfilled ? " — reached" : " — not yet reached"}`;
          const stageIcon = (
            <span className={`${styles["timeline-icon"]} ${node.fulfilled ? styles["is-fulfilled"] : styles["is-pending"]}`}>
              {node.icon}
            </span>
          );
          const stageDate = node.date && <span className={styles["timeline-date"]}>{formatNodeDate(node.date)}</span>;
          return node.href ? (
            <Link key={node.key} href={node.href} className={styles["timeline-node"]} title={stageTitle}>
              {stageIcon}
              {stageDate}
            </Link>
          ) : (
            <div key={node.key} className={styles["timeline-node"]} title={stageTitle}>
              {stageIcon}
              {stageDate}
            </div>
          );
        }
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
      })}
    </div>
  );
}
