"use client";

import Link from "next/link";
import { STAGES, type Stage } from "@/lib/salesBoard";
import type { EventType } from "@/lib/events";
import styles from "./next-actions.module.css";

// A dedicated, timeline-only list of milestones — deliberately separate
// from the Sales Board's STAGES array (which drives the actual pipeline
// columns), so this list's icons/membership can be trimmed or extended
// later without touching the pipeline itself. Starts as a 1:1 mirror of
// STAGES per the initial ask.
const TIMELINE_STAGES: { stage: Stage; icon: string }[] = [
  { stage: "Lead", icon: "🌱" },
  { stage: "Propose", icon: "📝" },
  { stage: "Sent", icon: "📤" },
  { stage: "Sold", icon: "🤝" },
  { stage: "Scheduled", icon: "📅" },
  { stage: "Project Management", icon: "🚧" },
  { stage: "Job Costing", icon: "🧮" },
  { stage: "Invoiced", icon: "🧾" },
  { stage: "Paid in Full", icon: "💰" },
];

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
  | { kind: "stage"; key: string; stage: Stage; icon: string; date: string | null; fulfilled: boolean }
  | { kind: "event"; key: string; icon: string | null; date: string; href: string; title: string };

function formatNodeDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DealTimeline({
  currentStage,
  stageDates,
  events,
}: {
  currentStage: Stage;
  stageDates: Partial<Record<Stage, string>>;
  events: TimelineEvent[];
}) {
  const currentIndex = STAGES.indexOf(currentStage);

  // Milestones always render in fixed pipeline order — never reordered or
  // displaced by event dates. Each calendar event is slotted into the gap
  // right after whichever milestone's date is the closest one on-or-before
  // the event's own date (skipping over any undated milestones in
  // between), or before the very first milestone if none qualify.
  const milestoneNodes: (TimelineNode & { kind: "stage" })[] = TIMELINE_STAGES.map(({ stage, icon }) => ({
    kind: "stage",
    key: `stage-${stage}`,
    stage,
    icon,
    date: stageDates[stage] ?? null,
    fulfilled: STAGES.indexOf(stage) <= currentIndex,
  }));

  const eventNodes: (TimelineNode & { kind: "event" })[] = events
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
      {nodes.map((node) =>
        node.kind === "stage" ? (
          <div
            key={node.key}
            className={styles["timeline-node"]}
            title={`${node.stage}${node.date ? ` — ${formatNodeDate(node.date)}` : node.fulfilled ? " — reached" : " — not yet reached"}`}
          >
            <span className={`${styles["timeline-icon"]} ${node.fulfilled ? styles["is-fulfilled"] : styles["is-pending"]}`}>
              {node.icon}
            </span>
            {node.date && <span className={styles["timeline-date"]}>{formatNodeDate(node.date)}</span>}
          </div>
        ) : (
          <Link key={node.key} href={node.href} className={styles["timeline-node"]} title={`${node.title} — ${formatNodeDate(node.date)}`}>
            {node.icon ? (
              <span className={`${styles["timeline-icon"]} ${styles["is-fulfilled"]}`}>{node.icon}</span>
            ) : (
              <span className={styles["timeline-dot"]} />
            )}
            <span className={styles["timeline-date"]}>{formatNodeDate(node.date)}</span>
          </Link>
        )
      )}
    </div>
  );
}
